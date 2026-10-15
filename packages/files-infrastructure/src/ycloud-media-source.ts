import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

function validateSource(link: string, mediaId: string): void {
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(mediaId) || link.length > 3000)
    throw new Error("Invalid YCloud media source");
  const url = new URL(link);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.ycloud.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== `/v2/whatsapp/media/download/${mediaId}` ||
    !url.searchParams.get("sig") ||
    !url.searchParams.get("payload") ||
    [...url.searchParams.keys()].some((key) => key !== "sig" && key !== "payload")
  )
    throw new Error("Invalid YCloud media source");
}

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update("qcrm-ycloud-inbound-media-source-v1").digest();
}

/** Encrypts a short-lived provider URL before it enters a durable job. Never log either value. */
export function sealYCloudMediaSource(link: string, mediaId: string, secret: string): string {
  validateSource(link, mediaId);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), nonce);
  cipher.setAAD(Buffer.from(mediaId));
  const data = Buffer.concat([cipher.update(link, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64url")}`;
}

export function openYCloudMediaSource(sealed: string, mediaId: string, secret: string): string {
  if (!sealed.startsWith("v1:") || sealed.length > 4100)
    throw new Error("Invalid YCloud media source");
  const packed = Buffer.from(sealed.slice(3), "base64url");
  if (packed.length < 29) throw new Error("Invalid YCloud media source");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(mediaId));
  decipher.setAuthTag(packed.subarray(12, 28));
  const link = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString(
    "utf8",
  );
  validateSource(link, mediaId);
  return link;
}
