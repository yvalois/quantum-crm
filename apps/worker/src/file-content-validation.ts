import { FileValidationError, type FileClass } from "@quantum-crm/domain";

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder("ascii").decode(bytes.subarray(offset, offset + length));
}

function detectText(bytes: Uint8Array, declaredMime: string): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return declaredMime === "text/csv" ? "text/csv" : "text/plain";
  } catch {
    return undefined;
  }
}

export function detectAllowedMime(
  fileClass: FileClass,
  declaredMime: string,
  bytes: Uint8Array,
): string {
  let detected: string | undefined;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    detected = "image/png";
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    detected = "image/jpeg";
  } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    detected = "image/webp";
  } else if (ascii(bytes, 0, 5) === "%PDF-") {
    detected = "application/pdf";
  } else if (ascii(bytes, 0, 4) === "OggS") {
    detected = "audio/ogg";
  } else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    detected = "audio/wav";
  } else if (
    ascii(bytes, 0, 3) === "ID3" ||
    (bytes[0] === 0xff && bytes[1] !== undefined && (bytes[1] & 0xe0) === 0xe0)
  ) {
    detected = "audio/mpeg";
  } else if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    detected = declaredMime === "audio/webm" ? "audio/webm" : "video/webm";
  } else if (ascii(bytes, 4, 4) === "ftyp") {
    detected = "video/mp4";
  } else if (fileClass === "DOCUMENT" && ["text/plain", "text/csv"].includes(declaredMime)) {
    detected = detectText(bytes, declaredMime);
  }

  if (!detected || detected !== declaredMime) {
    throw new FileValidationError("Observed file signature does not match its declared type");
  }
  return detected;
}
