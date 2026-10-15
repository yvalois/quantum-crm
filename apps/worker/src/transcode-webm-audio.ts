import { spawn } from "node:child_process";

import { FileValidationError } from "@quantum-crm/domain";
import type { OutboundMedia } from "@quantum-crm/files-infrastructure";

const maxAudioBytes = 16_000_000;

/** Remux browser-recorded Opus from WebM into WhatsApp-supported OGG, without re-encoding. */
export async function transcodeWebmAudio(media: OutboundMedia): Promise<OutboundMedia> {
  if (media.mimeType !== "audio/webm") return media;
  if (media.bytes.byteLength === 0 || media.bytes.byteLength > maxAudioBytes)
    throw new FileValidationError("Recorded audio exceeds WhatsApp limit");

  const child = spawn(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "copy",
      "-f",
      "ogg",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "ignore"], signal: AbortSignal.timeout(15_000) },
  );
  const chunks: Buffer[] = [];
  let size = 0;
  const converted = await new Promise<Buffer>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxAudioBytes) {
        child.kill();
        reject(new FileValidationError("Converted audio exceeds WhatsApp limit"));
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", () => reject(new FileValidationError("Audio conversion unavailable")));
    child.stdin.once("error", () => reject(new FileValidationError("Audio conversion failed")));
    child.once("close", (code) => {
      if (code !== 0 || size < 4) {
        reject(new FileValidationError("Audio conversion failed"));
        return;
      }
      resolve(Buffer.concat(chunks, size));
    });
    child.stdin.end(media.bytes);
  });
  if (converted.toString("ascii", 0, 4) !== "OggS")
    throw new FileValidationError("Converted audio is not OGG");
  return {
    bytes: converted,
    mimeType: "audio/ogg",
    filename: `${media.filename.replace(/\.[^.]+$/u, "")}.ogg`,
  };
}
