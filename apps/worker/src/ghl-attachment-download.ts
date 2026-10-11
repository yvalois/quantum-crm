import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { FileClass } from "@quantum-crm/domain";

const hosts = new Set([
  "static-assets.internal.usercontent.site",
  "assets.cdn.filesafe.space",
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
  "lookaside.fbsbx.com",
  "lh3.googleusercontent.com",
]);
const formats: Readonly<Record<string, readonly [string, FileClass, number]>> = {
  png: ["image/png", "IMAGE", 20],
  jpg: ["image/jpeg", "IMAGE", 20],
  jpeg: ["image/jpeg", "IMAGE", 20],
  webp: ["image/webp", "IMAGE", 20],
  pdf: ["application/pdf", "DOCUMENT", 50],
  ogg: ["audio/ogg", "AUDIO", 50],
  mp3: ["audio/mpeg", "AUDIO", 50],
  wav: ["audio/wav", "AUDIO", 50],
  mp4: ["video/mp4", "VIDEO", 250],
  webm: ["video/webm", "VIDEO", 250],
};
export class GhlAttachmentDownloadError extends Error {
  public constructor(
    public readonly code: "SOURCE_UNAVAILABLE" | "UNSUPPORTED_FORMAT" | "SIZE_LIMIT",
  ) {
    super(code);
  }
}
export function attachmentUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE");
  }
  if (
    url.protocol !== "https:" ||
    !hosts.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    value.length > 16384
  ) {
    throw new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE");
  }
  return url;
}
/** Pinned IPv4 resolution denies internal, loopback, link-local, multicast and reserved ranges. */
export function publicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  const [a, b] = parts;
  return (
    a !== undefined &&
    b !== undefined &&
    a > 0 &&
    a < 224 &&
    a !== 10 &&
    a !== 127 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 100 && b >= 64 && b <= 127) &&
    !(a === 198 && (b === 18 || b === 19))
  );
}
export function attachmentFormat(url: URL, contentType: string | undefined) {
  const extension = /\.([a-z0-9]{1,8})$/iu.exec(url.pathname)?.[1]?.toLowerCase();
  const byExtension = extension ? formats[extension] : undefined;
  const mime = contentType?.split(";")[0]?.trim().toLowerCase();
  const format =
    byExtension ??
    (!extension ? Object.values(formats).find(([type]) => type === mime) : undefined);
  if (!format) throw new GhlAttachmentDownloadError("UNSUPPORTED_FORMAT");
  if (
    mime &&
    mime !== "application/octet-stream" &&
    mime !== "binary/octet-stream" &&
    mime !== format[0]
  )
    throw new GhlAttachmentDownloadError("UNSUPPORTED_FORMAT");
  return {
    mime: format[0],
    fileClass: format[1],
    maxBytes: format[2] * 1024 * 1024,
    extension:
      extension ?? Object.keys(formats).find((key) => formats[key]?.[0] === format[0]) ?? "bin",
  };
}
export async function downloadGhlAttachment(
  value: string,
  redirects = 0,
): Promise<{
  bytes: Uint8Array;
  mime: string;
  fileClass: FileClass;
  name: string;
}> {
  const url = attachmentUrl(value);
  try {
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { family: 4, all: true }),
      new Promise<never>((_resolve, reject) => {
        dnsTimer = setTimeout(
          () => reject(new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE")),
          10_000,
        );
      }),
    ]).finally(() => {
      if (dnsTimer) clearTimeout(dnsTimer);
    });
    if (!addresses.length || addresses.some(({ address }) => !publicIpv4(address)))
      throw new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE");
    const selected = addresses[0]!;
    const result = await new Promise<
      { redirect: string } | { bytes: Uint8Array; mime: string; fileClass: FileClass; name: string }
    >((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          agent: false,
          signal: AbortSignal.timeout(90_000),
          headers: { "accept-encoding": "identity", "user-agent": "Quantum-CRM-Migration/1" },
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [selected]);
            else callback(null, selected.address, 4);
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
            response.destroy();
            try {
              resolve({ redirect: new URL(response.headers.location, url).href });
            } catch {
              reject(new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE"));
            }
            return;
          }
          if (status !== 200) {
            response.destroy();
            reject(new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE"));
            return;
          }
          try {
            const format = attachmentFormat(url, response.headers["content-type"]);
            const length = Number(response.headers["content-length"] ?? 0);
            if (!Number.isFinite(length) || length > format.maxBytes)
              throw new GhlAttachmentDownloadError("SIZE_LIMIT");
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > format.maxBytes) {
                response.destroy();
                reject(new GhlAttachmentDownloadError("SIZE_LIMIT"));
              } else chunks.push(chunk);
            });
            response.on("error", () =>
              reject(new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE")),
            );
            response.on("end", () => {
              if (!size || (length && size !== length)) {
                reject(new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE"));
                return;
              }
              resolve({
                bytes: Buffer.concat(chunks),
                mime: format.mime,
                fileClass: format.fileClass,
                name: `Adjunto.${format.extension}`,
              });
            });
          } catch (error) {
            response.destroy();
            reject(error);
          }
        },
      );
      req.on("error", () => reject(new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE")));
      req.end();
    });
    if ("redirect" in result) {
      if (redirects >= 3) throw new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE");
      return await downloadGhlAttachment(result.redirect, redirects + 1);
    }
    return result;
  } catch (error) {
    if (error instanceof GhlAttachmentDownloadError) throw error;
    throw new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE");
  }
}
