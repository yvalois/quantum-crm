import { createHash, createHmac } from "node:crypto";

export interface ObjectStorageCredentials {
  readonly accessKey: string;
  readonly secretKey: string;
}

export interface ObjectStorageClientOptions {
  readonly endpoint: string;
  readonly publicEndpoint?: string;
  readonly region: string;
  readonly incomingBucket: string;
  readonly objectsBucket: string;
  readonly credentials: ObjectStorageCredentials;
  readonly requestTimeoutMs: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export interface BrowserPostCommand {
  readonly objectKey: string;
  readonly expectedSha256Base64: string;
  readonly contentType: string;
  readonly maxBytes: number;
  readonly expiresInSeconds: number;
}

export interface BrowserPostAuthorization {
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

export interface DownloadAuthorizationCommand {
  readonly objectKey: string;
  readonly versionId: string;
  readonly expiresInSeconds: number;
  readonly responseContentType?: string;
  readonly responseContentDisposition?: string;
}

export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: string | undefined;
  readonly contentLength: number;
  readonly versionId: string;
}

export interface ObjectStorageClient {
  readonly reserveUpload: (command: BrowserPostCommand) => BrowserPostAuthorization;
  readonly inspectIncomingUpload: (
    objectKey: string,
  ) => Promise<{ readonly versionId: string; readonly receipt: string }>;
  readonly presignDownload: (command: DownloadAuthorizationCommand) => string;
  readonly getIncomingVersion: (
    objectKey: string,
    versionId: string,
    maxBytes: number,
  ) => Promise<StoredObject>;
  readonly copyToObjects: (
    sourceKey: string,
    sourceVersionId: string,
    destinationKey: string,
    contentType: string,
    expectedSha256Base64: string,
  ) => Promise<string>;
  readonly getObjectVersion: (
    objectKey: string,
    versionId: string,
    maxBytes: number,
  ) => Promise<StoredObject>;
  readonly deleteIncomingVersion: (objectKey: string, versionId: string) => Promise<void>;
}

export type ObjectStorageFailure =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "TOO_LARGE"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

export class ObjectStorageError extends Error {
  public constructor(public readonly failure: ObjectStorageFailure) {
    super(`Object storage operation failed: ${failure}`);
    this.name = "ObjectStorageError";
  }
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Headers;
}

const objectKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,511}$/u;
const versionPattern = /^[^\0\r\n]{1,1024}$/u;
const base64Sha256Pattern = /^[A-Za-z0-9+/]{43}=$/u;

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(path: string): string {
  return path
    .split("/")
    .map((part) => awsEncode(part))
    .join("/");
}

function timestamp(now: Date): { readonly short: string; readonly full: string } {
  const full = now.toISOString().replace(/[-:]|\.\d{3}/gu, "");
  return { short: full.slice(0, 8), full };
}

function signingKey(secretKey: string, shortDate: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretKey}`, shortDate), region), "s3"), "aws4_request");
}

function normalizedEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new ObjectStorageError("INVALID_INPUT");
  }
  return endpoint.href.replace(/\/$/u, "");
}

function assertObjectKey(value: string): void {
  if (!objectKeyPattern.test(value) || value.includes("..") || value.includes("//")) {
    throw new ObjectStorageError("INVALID_INPUT");
  }
}

function assertVersion(value: string): void {
  if (!versionPattern.test(value)) throw new ObjectStorageError("INVALID_INPUT");
}

function canonicalQuery(values: readonly (readonly [string, string])[]): string {
  return values
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const left = leftKey === rightKey ? leftValue : leftKey;
      const right = leftKey === rightKey ? rightValue : rightKey;
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function authorizeRequest(
  options: ObjectStorageClientOptions,
  endpointValue: string,
  method: string,
  bucket: string,
  objectKey: string,
  query: readonly (readonly [string, string])[],
  additionalHeaders: Readonly<Record<string, string>> = {},
): SignedRequest {
  const endpoint = new URL(endpointValue);
  const path = `${endpoint.pathname.replace(/\/$/u, "")}/${bucket}/${objectKey}`;
  const now = timestamp((options.now ?? (() => new Date()))());
  const payloadHash = hash("");
  const headerValues: Record<string, string> = {
    host: endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now.full,
    ...Object.fromEntries(
      Object.entries(additionalHeaders).map(([key, value]) => [key.toLowerCase(), value.trim()]),
    ),
  };
  const signedHeaderNames = Object.keys(headerValues).sort();
  const canonicalHeaders = signedHeaderNames
    .map((key) => `${key}:${headerValues[key]!.replace(/\s+/gu, " ")}\n`)
    .join("");
  const encodedQuery = canonicalQuery(query);
  const canonicalRequest = [
    method,
    canonicalPath(path),
    encodedQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${now.short}/${options.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now.full, scope, hash(canonicalRequest)].join("\n");
  const signature = createHmac(
    "sha256",
    signingKey(options.credentials.secretKey, now.short, options.region),
  )
    .update(stringToSign)
    .digest("hex");
  const headers = new Headers(additionalHeaders);
  headers.set("x-amz-content-sha256", payloadHash);
  headers.set("x-amz-date", now.full);
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${options.credentials.accessKey}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
  );
  return {
    url: `${endpoint.origin}${path}${encodedQuery ? `?${encodedQuery}` : ""}`,
    headers,
  };
}

function classify(status: number): ObjectStorageFailure {
  if (status === 401 || status === 403) return "PERMISSION_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status >= 500 || status === 408 || status === 429) return "UNAVAILABLE";
  return "INVALID_RESPONSE";
}

async function request(
  options: ObjectStorageClientOptions,
  method: string,
  bucket: string,
  key: string,
  query: readonly (readonly [string, string])[],
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const signed = authorizeRequest(
    options,
    normalizedEndpoint(options.endpoint),
    method,
    bucket,
    key,
    query,
    headers,
  );
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(signed.url, {
      method,
      headers: signed.headers,
      signal: AbortSignal.timeout(options.requestTimeoutMs),
    });
  } catch {
    throw new ObjectStorageError("UNAVAILABLE");
  }
  if (!response.ok) throw new ObjectStorageError(classify(response.status));
  return response;
}

async function readStoredObject(
  options: ObjectStorageClientOptions,
  bucket: string,
  key: string,
  versionId: string,
  maxBytes: number,
): Promise<StoredObject> {
  assertObjectKey(key);
  assertVersion(versionId);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new ObjectStorageError("INVALID_INPUT");
  const response = await request(options, "GET", bucket, key, [["versionId", versionId]]);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ObjectStorageError("TOO_LARGE");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new ObjectStorageError("TOO_LARGE");
  const observedVersion = response.headers.get("x-amz-version-id") ?? versionId;
  if (observedVersion !== versionId) throw new ObjectStorageError("INVALID_RESPONSE");
  return Object.freeze({
    bytes,
    contentType: response.headers.get("content-type") ?? undefined,
    contentLength: bytes.byteLength,
    versionId,
  });
}

export function createS3ObjectStorage(options: ObjectStorageClientOptions): ObjectStorageClient {
  const internalEndpoint = normalizedEndpoint(options.endpoint);
  const publicEndpoint = options.publicEndpoint
    ? normalizedEndpoint(options.publicEndpoint)
    : internalEndpoint;
  if (!/^https:/u.test(publicEndpoint) && options.publicEndpoint) {
    throw new ObjectStorageError("INVALID_INPUT");
  }
  const fixedOptions = Object.freeze({ ...options, endpoint: internalEndpoint, publicEndpoint });

  return Object.freeze({
    reserveUpload: (command: BrowserPostCommand) => {
      assertObjectKey(command.objectKey);
      if (
        !base64Sha256Pattern.test(command.expectedSha256Base64) ||
        !Number.isSafeInteger(command.maxBytes) ||
        command.maxBytes < 1 ||
        !Number.isSafeInteger(command.expiresInSeconds) ||
        command.expiresInSeconds < 30 ||
        command.expiresInSeconds > 600 ||
        !/^[a-z0-9][a-z0-9.+-]{0,126}\/[a-z0-9][a-z0-9.+-]{0,126}$/u.test(command.contentType)
      ) {
        throw new ObjectStorageError("INVALID_INPUT");
      }
      const nowValue = (fixedOptions.now ?? (() => new Date()))();
      const now = timestamp(nowValue);
      const expiresAt = new Date(nowValue.getTime() + command.expiresInSeconds * 1_000);
      const scope = `${now.short}/${fixedOptions.region}/s3/aws4_request`;
      const credential = `${fixedOptions.credentials.accessKey}/${scope}`;
      const policy = {
        expiration: expiresAt.toISOString(),
        conditions: [
          { bucket: fixedOptions.incomingBucket },
          { key: command.objectKey },
          { "Content-Type": command.contentType },
          { "x-amz-meta-qcrm-sha256": command.expectedSha256Base64 },
          { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
          { "x-amz-credential": credential },
          { "x-amz-date": now.full },
          { success_action_status: "201" },
          ["content-length-range", 1, command.maxBytes],
        ],
      };
      const encodedPolicy = Buffer.from(JSON.stringify(policy)).toString("base64");
      const signature = createHmac(
        "sha256",
        signingKey(fixedOptions.credentials.secretKey, now.short, fixedOptions.region),
      )
        .update(encodedPolicy)
        .digest("hex");
      return Object.freeze({
        url: `${publicEndpoint}/${fixedOptions.incomingBucket}`,
        fields: Object.freeze({
          key: command.objectKey,
          "Content-Type": command.contentType,
          "x-amz-meta-qcrm-sha256": command.expectedSha256Base64,
          "x-amz-algorithm": "AWS4-HMAC-SHA256",
          "x-amz-credential": credential,
          "x-amz-date": now.full,
          success_action_status: "201",
          policy: encodedPolicy,
          "x-amz-signature": signature,
        }),
        expiresAt: expiresAt.toISOString(),
      });
    },
    inspectIncomingUpload: async (key: string) => {
      assertObjectKey(key);
      const response = await request(fixedOptions, "HEAD", fixedOptions.incomingBucket, key, []);
      const versionId = response.headers.get("x-amz-version-id");
      const receipt = response.headers.get("etag");
      if (!versionId || !receipt) throw new ObjectStorageError("INVALID_RESPONSE");
      assertVersion(versionId);
      assertVersion(receipt);
      return Object.freeze({ versionId, receipt });
    },
    presignDownload: (command: DownloadAuthorizationCommand) => {
      assertObjectKey(command.objectKey);
      assertVersion(command.versionId);
      if (
        !Number.isSafeInteger(command.expiresInSeconds) ||
        command.expiresInSeconds < 15 ||
        command.expiresInSeconds > 120
      ) {
        throw new ObjectStorageError("INVALID_INPUT");
      }
      const endpoint = new URL(publicEndpoint);
      const path = `${endpoint.pathname.replace(/\/$/u, "")}/${fixedOptions.objectsBucket}/${command.objectKey}`;
      const now = timestamp((fixedOptions.now ?? (() => new Date()))());
      const scope = `${now.short}/${fixedOptions.region}/s3/aws4_request`;
      const query: Array<readonly [string, string]> = [
        ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
        ["X-Amz-Credential", `${fixedOptions.credentials.accessKey}/${scope}`],
        ["X-Amz-Date", now.full],
        ["X-Amz-Expires", String(command.expiresInSeconds)],
        ["X-Amz-SignedHeaders", "host"],
        ["versionId", command.versionId],
      ];
      if (command.responseContentType) {
        query.push(["response-content-type", command.responseContentType]);
      }
      if (command.responseContentDisposition) {
        query.push(["response-content-disposition", command.responseContentDisposition]);
      }
      const encodedQuery = canonicalQuery(query);
      const canonicalRequest = [
        "GET",
        canonicalPath(path),
        encodedQuery,
        `host:${endpoint.host}\n`,
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n");
      const stringToSign = ["AWS4-HMAC-SHA256", now.full, scope, hash(canonicalRequest)].join("\n");
      const signature = createHmac(
        "sha256",
        signingKey(fixedOptions.credentials.secretKey, now.short, fixedOptions.region),
      )
        .update(stringToSign)
        .digest("hex");
      return `${endpoint.origin}${path}?${encodedQuery}&X-Amz-Signature=${signature}`;
    },
    getIncomingVersion: (key: string, versionId: string, maxBytes: number) =>
      readStoredObject(fixedOptions, fixedOptions.incomingBucket, key, versionId, maxBytes),
    copyToObjects: async (
      sourceKey: string,
      sourceVersionId: string,
      destinationKey: string,
      contentType: string,
      expectedSha256Base64: string,
    ) => {
      assertObjectKey(sourceKey);
      assertObjectKey(destinationKey);
      assertVersion(sourceVersionId);
      if (!base64Sha256Pattern.test(expectedSha256Base64)) {
        throw new ObjectStorageError("INVALID_INPUT");
      }
      const existing = await request(
        fixedOptions,
        "HEAD",
        fixedOptions.objectsBucket,
        destinationKey,
        [],
      ).catch((error: unknown) => {
        if (error instanceof ObjectStorageError && error.failure === "NOT_FOUND") return undefined;
        throw error;
      });
      if (existing) {
        const existingVersion = existing.headers.get("x-amz-version-id");
        if (
          existingVersion &&
          existing.headers.get("x-amz-meta-qcrm-source-version") === sourceVersionId &&
          existing.headers.get("x-amz-meta-qcrm-sha256") === expectedSha256Base64
        ) {
          return existingVersion;
        }
        throw new ObjectStorageError("INVALID_RESPONSE");
      }
      const copySource = `/${fixedOptions.incomingBucket}/${sourceKey}?versionId=${encodeURIComponent(sourceVersionId)}`;
      const response = await request(
        fixedOptions,
        "PUT",
        fixedOptions.objectsBucket,
        destinationKey,
        [],
        {
          "content-type": contentType,
          "x-amz-copy-source": copySource,
          "x-amz-metadata-directive": "REPLACE",
          "x-amz-meta-qcrm-source-version": sourceVersionId,
          "x-amz-meta-qcrm-sha256": expectedSha256Base64,
        },
      );
      const versionId = response.headers.get("x-amz-version-id");
      if (!versionId) throw new ObjectStorageError("INVALID_RESPONSE");
      return versionId;
    },
    getObjectVersion: (key: string, versionId: string, maxBytes: number) =>
      readStoredObject(fixedOptions, fixedOptions.objectsBucket, key, versionId, maxBytes),
    deleteIncomingVersion: async (key: string, versionId: string) => {
      assertObjectKey(key);
      assertVersion(versionId);
      await request(fixedOptions, "DELETE", fixedOptions.incomingBucket, key, [
        ["versionId", versionId],
      ]);
    },
  });
}
