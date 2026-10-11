import { createHash } from "node:crypto";

import { ObjectStorageError } from "./s3-object-storage.js";

export interface ReservedFileUploadAuthorization {
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresAt: Date | string;
}

export interface ReservedFileUploadOptions {
  readonly authorization: ReservedFileUploadAuthorization;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly requestTimeoutMs: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/** Consumes a Files reservation; retries and immutable completion remain with Files. */
export async function uploadReservedFile(options: ReservedFileUploadOptions): Promise<{
  readonly versionId?: string;
  readonly receipt?: string;
}> {
  const { authorization, bytes } = options;
  let endpoint: URL;
  try {
    endpoint = new URL(authorization.url);
  } catch {
    throw new ObjectStorageError("INVALID_INPUT");
  }
  const expiresAt = new Date(authorization.expiresAt).getTime();
  const now = (options.now ?? (() => new Date()))().getTime();
  const fields = Object.entries(authorization.fields);
  if (
    !["https:", "http:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > 600_000 ||
    !Number.isSafeInteger(options.maxBytes) ||
    options.maxBytes < 1 ||
    options.maxBytes > 250 * 1024 * 1024 ||
    bytes.byteLength < 1 ||
    bytes.byteLength > options.maxBytes ||
    !Number.isSafeInteger(options.requestTimeoutMs) ||
    options.requestTimeoutMs < 1 ||
    options.requestTimeoutMs > 300_000 ||
    fields.length < 1 ||
    fields.length > 32 ||
    fields.some(([key, value]) => key.length > 128 || value.length > 8_192 || key === "file") ||
    !authorization.fields["Content-Type"] ||
    !authorization.fields["policy"] ||
    authorization.fields["success_action_status"] !== "201" ||
    authorization.fields["x-amz-meta-qcrm-sha256"] !==
      createHash("sha256").update(bytes).digest("base64")
  ) {
    throw new ObjectStorageError("INVALID_INPUT");
  }

  const body = new FormData();
  for (const [key, value] of fields) body.append(key, value);
  body.append(
    "file",
    new Blob([new Uint8Array(bytes).buffer], { type: authorization.fields["Content-Type"] }),
    "upload",
  );
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(endpoint, {
      method: "POST",
      body,
      redirect: "error",
      signal: AbortSignal.timeout(options.requestTimeoutMs),
    });
  } catch {
    // Do not expose URLs, signed fields, response bodies or transport diagnostics.
    throw new ObjectStorageError("UNAVAILABLE");
  }
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403) {
    throw new ObjectStorageError("PERMISSION_DENIED");
  }
  if (response.status === 413) throw new ObjectStorageError("TOO_LARGE");
  if (response.status >= 500 || response.status === 429) {
    throw new ObjectStorageError("UNAVAILABLE");
  }
  if (response.status !== 201 || response.redirected) {
    throw new ObjectStorageError("INVALID_RESPONSE");
  }
  const versionId = response.headers.get("x-amz-version-id");
  const receipt = response.headers.get("etag");
  if ([versionId, receipt].some((value) => value !== null && !/^[^\0\r\n]{1,1024}$/u.test(value))) {
    throw new ObjectStorageError("INVALID_RESPONSE");
  }
  return Object.freeze({
    ...(versionId === null ? {} : { versionId }),
    ...(receipt === null ? {} : { receipt }),
  });
}
