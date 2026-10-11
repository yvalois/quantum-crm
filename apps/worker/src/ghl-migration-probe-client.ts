import { ghlApiOrigin, ghlApiVersion, type SecretValue } from "@quantum-crm/config";

export type GhlApiVersion = typeof ghlApiVersion;
export type GhlProbeResource =
  | "CONTACTS"
  | "TAGS"
  | "CUSTOM_FIELDS"
  | "PIPELINES"
  | "OPPORTUNITIES"
  | "CONVERSATIONS"
  | "MESSAGES";

export type GhlProbeErrorCode =
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "UNEXPECTED_RESPONSE";

export class GhlMigrationProbeError extends Error {
  public constructor(
    public readonly code: GhlProbeErrorCode,
    public readonly resource: string,
  ) {
    super(`GHL migration probe failed: ${code}`);
    this.name = "GhlMigrationProbeError";
  }
}

export interface GhlReadOnlyRequest {
  readonly resource: GhlProbeResource;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly apiVersion?: GhlApiVersion;
}

export interface GhlReadOnlyClientOptions {
  readonly apiOrigin: string;
  readonly locationId: string;
  readonly token: SecretValue;
  readonly requestTimeoutMs: number;
  readonly fetcher?: typeof fetch;
  readonly sleep?: (durationMs: number) => Promise<void>;
  /** Absolute process deadline supplied only by the ephemeral discovery CLI. */
  readonly deadlineEpochMilliseconds?: number;
  readonly now?: () => number;
  readonly maxResponseBytes?: number;
  readonly maxAttempts?: number;
}

const defaultResponseLimitBytes = 5 * 1024 * 1024;
const defaultAttempts = 3;
const supportedApiVersions = new Set<GhlApiVersion>([ghlApiVersion]);

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000);
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) return Math.max(0, Math.min(when - Date.now(), 30_000));
  }
  const base = Math.min(250 * 2 ** attempt, 5_000);
  return Math.min(base + Math.floor(Math.random() * Math.max(1, base / 4)), 5_000);
}

function responseErrorCode(response: Response): GhlProbeErrorCode {
  if (response.status === 401 || response.status === 403) return "FORBIDDEN";
  if (response.status === 400 || response.status === 422) return "INVALID_REQUEST";
  if (response.status === 404) return "NOT_FOUND";
  if (response.status === 429) return "RATE_LIMITED";
  return "UNAVAILABLE";
}

function canRetry(response: Response | undefined): boolean {
  return response?.status === 429 || (response !== undefined && response.status >= 500);
}

function asObject(value: unknown, resource: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GhlMigrationProbeError("UNEXPECTED_RESPONSE", resource);
  }
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

function requiredQueryValue(
  url: URL,
  name: string,
  expectedValue: string,
  resource: GhlProbeResource,
): void {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || values[0] !== expectedValue) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", resource);
  }
}

function requiredBoundedIntegerQuery(
  url: URL,
  name: string,
  minimum: number,
  maximum: number,
  resource: GhlProbeResource,
): void {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || !/^\d+$/u.test(values[0] ?? "")) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", resource);
  }
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", resource);
  }
}

function optionalMessageChannel(url: URL): void {
  const values = url.searchParams.getAll("channel");
  if (values.length > 1 || (values.length === 1 && values[0] !== "Email")) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", "MESSAGES");
  }
}

function allowedQueryKeys(
  url: URL,
  allowedKeys: readonly string[],
  resource: GhlProbeResource,
): void {
  const allowed = new Set(allowedKeys);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", resource);
  }
}

function optionalCursor(url: URL, name: string, resource: GhlProbeResource): void {
  const values = url.searchParams.getAll(name);
  if (
    values.length > 1 ||
    values.some(
      (value) => value.length < 1 || value.length > 16_384 || /[\u0000-\u001f]/u.test(value),
    )
  ) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", resource);
  }
}

function validateReadOnlyRequest(
  input: GhlReadOnlyRequest,
  apiOrigin: string,
  locationId: string,
): URL {
  if (input.method !== "GET" && input.method !== "POST") {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  if (!input.path.startsWith("/") || input.path.startsWith("//") || input.path.includes("\\")) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  if (input.method === "GET" && input.body !== undefined) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }

  let origin: URL;
  try {
    origin = new URL(apiOrigin);
  } catch {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  if (
    origin.origin !== ghlApiOrigin ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  let url: URL;
  try {
    url = new URL(input.path, origin);
  } catch {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  if (url.origin !== origin.origin) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  if (!supportedApiVersions.has(input.apiVersion ?? ghlApiVersion)) {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  if (input.method === "POST") {
    const bodyKeys = input.body ? Object.keys(input.body) : [];
    const page = input.body?.page;
    const searchAfter = input.body?.searchAfter;
    const pageLimit = input.body?.pageLimit;
    if (
      input.resource !== "CONTACTS" ||
      url.pathname !== "/contacts/search" ||
      url.search.length > 0 ||
      bodyKeys.some((key) => !["locationId", "page", "pageLimit", "searchAfter"].includes(key)) ||
      input.body?.locationId !== locationId ||
      (searchAfter === undefined
        ? page !== 1
        : page !== undefined ||
          !Array.isArray(searchAfter) ||
          searchAfter.length !== 2 ||
          !searchAfter.every(
            (value: unknown) =>
              (typeof value === "number" && Number.isFinite(value)) ||
              (typeof value === "string" &&
                value.length > 0 &&
                value.length <= 256 &&
                !/[\u0000-\u001f]/u.test(value)),
          )) ||
      typeof pageLimit !== "number" ||
      !Number.isSafeInteger(pageLimit) ||
      pageLimit < 1 ||
      pageLimit > 100
    ) {
      throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
    }
    return url;
  }

  if (input.resource === "CONTACTS") {
    throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  switch (input.resource) {
    case "TAGS":
      if (
        url.pathname !== `/locations/${encodeURIComponent(locationId)}/tags` ||
        url.search.length > 0
      ) {
        throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
      }
      break;
    case "CUSTOM_FIELDS":
      if (url.pathname !== `/locations/${encodeURIComponent(locationId)}/customFields`) {
        throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
      }
      allowedQueryKeys(url, ["model"], input.resource);
      requiredQueryValue(url, "model", "all", input.resource);
      break;
    case "PIPELINES":
      if (url.pathname !== "/opportunities/pipelines") {
        throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
      }
      allowedQueryKeys(url, ["locationId"], input.resource);
      requiredQueryValue(url, "locationId", locationId, input.resource);
      break;
    case "OPPORTUNITIES":
      if (url.pathname !== "/opportunities/search") {
        throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
      }
      allowedQueryKeys(
        url,
        ["locationId", "status", "order", "limit", "startAfter", "startAfterId"],
        input.resource,
      );
      requiredQueryValue(url, "locationId", locationId, input.resource);
      requiredQueryValue(url, "status", "all", input.resource);
      requiredQueryValue(url, "order", "added_asc", input.resource);
      requiredBoundedIntegerQuery(url, "limit", 1, 100, input.resource);
      optionalCursor(url, "startAfter", input.resource);
      optionalCursor(url, "startAfterId", input.resource);
      if (url.searchParams.has("startAfter") !== url.searchParams.has("startAfterId")) {
        throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
      }
      break;
    case "CONVERSATIONS":
      if (url.pathname !== "/conversations/search") {
        throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
      }
      allowedQueryKeys(
        url,
        ["locationId", "limit", "sort", "sortBy", "startAfterDate"],
        input.resource,
      );
      requiredQueryValue(url, "locationId", locationId, input.resource);
      requiredBoundedIntegerQuery(url, "limit", 1, 100, input.resource);
      optionalCursor(url, "startAfterDate", input.resource);
      if (url.searchParams.has("sort")) requiredQueryValue(url, "sort", "asc", input.resource);
      if (url.searchParams.has("sortBy"))
        requiredQueryValue(url, "sortBy", "last_message_date", input.resource);
      break;
    case "MESSAGES":
      if (url.pathname !== "/conversations/messages/export") {
        throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
      }
      allowedQueryKeys(
        url,
        ["locationId", "limit", "channel", "cursor", "sortBy", "sortOrder"],
        input.resource,
      );
      requiredQueryValue(url, "locationId", locationId, input.resource);
      requiredBoundedIntegerQuery(url, "limit", 10, 1_000, input.resource);
      optionalMessageChannel(url);
      optionalCursor(url, "cursor", input.resource);
      if (url.searchParams.has("sortBy"))
        requiredQueryValue(url, "sortBy", "createdAt", input.resource);
      if (url.searchParams.has("sortOrder"))
        requiredQueryValue(url, "sortOrder", "asc", input.resource);
      break;
    default:
      throw new GhlMigrationProbeError("INVALID_REQUEST", input.resource);
  }
  return url;
}

export class GhlReadOnlyClient {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (durationMs: number) => Promise<void>;
  private readonly now: () => number;
  private readonly maxResponseBytes: number;
  private readonly maxAttempts: number;

  public constructor(private readonly options: GhlReadOnlyClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? delay;
    this.now = options.now ?? Date.now;
    this.maxResponseBytes = options.maxResponseBytes ?? defaultResponseLimitBytes;
    this.maxAttempts = options.maxAttempts ?? defaultAttempts;
    if (
      options.deadlineEpochMilliseconds !== undefined &&
      (!Number.isSafeInteger(options.deadlineEpochMilliseconds) ||
        options.deadlineEpochMilliseconds <= this.now())
    ) {
      throw new Error("invalid GHL migration probe deadline");
    }
  }

  private remainingDeadlineMilliseconds(): number | undefined {
    if (this.options.deadlineEpochMilliseconds === undefined) return undefined;
    return this.options.deadlineEpochMilliseconds - this.now();
  }

  private async waitForRetry(
    response: Response | undefined,
    attempt: number,
    resource: string,
  ): Promise<void> {
    const retryIn = retryDelay(response, attempt);
    const remaining = this.remainingDeadlineMilliseconds();
    if (remaining !== undefined && (remaining <= 0 || retryIn >= remaining)) {
      throw new GhlMigrationProbeError("TIMEOUT", resource);
    }
    await this.sleep(retryIn);
  }

  public async request(input: GhlReadOnlyRequest): Promise<Readonly<Record<string, unknown>>> {
    const url = validateReadOnlyRequest(input, this.options.apiOrigin, this.options.locationId);
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      const remaining = this.remainingDeadlineMilliseconds();
      if (remaining !== undefined && remaining <= 0) {
        throw new GhlMigrationProbeError("TIMEOUT", input.resource);
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        remaining === undefined
          ? this.options.requestTimeoutMs
          : Math.min(this.options.requestTimeoutMs, remaining),
      );
      try {
        const response = await this.fetcher(url, {
          method: input.method,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.options.token.expose()}`,
            Version: input.apiVersion ?? ghlApiVersion,
            ...(input.body ? { "Content-Type": "application/json" } : {}),
          },
          ...(input.body ? { body: JSON.stringify(input.body) } : {}),
          redirect: "error",
          signal: controller.signal,
        });
        lastResponse = response;
        if (!response.ok) {
          await response.body?.cancel();
          if (canRetry(response) && attempt + 1 < this.maxAttempts) {
            await this.waitForRetry(response, attempt, input.resource);
            continue;
          }
          throw new GhlMigrationProbeError(responseErrorCode(response), input.resource);
        }
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
          throw new GhlMigrationProbeError("RESPONSE_TOO_LARGE", input.resource);
        }
        const chunks: Uint8Array[] = [];
        let byteLength = 0;
        const reader = response.body?.getReader();
        if (!reader) throw new GhlMigrationProbeError("UNEXPECTED_RESPONSE", input.resource);
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            byteLength += chunk.value.byteLength;
            if (byteLength > this.maxResponseBytes) {
              await reader.cancel();
              throw new GhlMigrationProbeError("RESPONSE_TOO_LARGE", input.resource);
            }
            chunks.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = Buffer.concat(chunks, byteLength);
        try {
          return asObject(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
            input.resource,
          );
        } catch (error) {
          if (error instanceof GhlMigrationProbeError) throw error;
          throw new GhlMigrationProbeError("UNEXPECTED_RESPONSE", input.resource);
        }
      } catch (error) {
        if (error instanceof GhlMigrationProbeError) throw error;
        if (controller.signal.aborted) {
          if (attempt + 1 < this.maxAttempts) {
            await this.waitForRetry(lastResponse, attempt, input.resource);
            continue;
          }
          throw new GhlMigrationProbeError("TIMEOUT", input.resource);
        }
        if (attempt + 1 < this.maxAttempts) {
          await this.waitForRetry(lastResponse, attempt, input.resource);
          continue;
        }
        throw new GhlMigrationProbeError("NETWORK", input.resource);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new GhlMigrationProbeError("UNAVAILABLE", input.resource);
  }
}
