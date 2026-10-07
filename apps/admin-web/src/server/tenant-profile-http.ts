import { validateCsrf, validateRequestOrigin } from "@quantum-crm/auth";
import { SecretValue } from "@quantum-crm/config";
import {
  CreateTenantProfileSchema,
  ConfirmTenantProfileDeletionSchema,
  DecommissioningOperationResponseSchema,
  RequestTenantDecommissioningSchema,
  TenantProfileListQuerySchema,
  TenantProfileListResponseSchema,
  TenantProfileResponseSchema,
  UpdateTenantProfileSchema,
  ActivationDeliveryResponseSchema,
  ProvisioningOperationResponseSchema,
  RequestTenantProvisioningSchema,
  RequestAutomaticTenantProvisioningSchema,
  RequestTenantReleasePromotionSchema,
  TenantReleasePromotionResponseSchema,
} from "@quantum-crm/contracts";

import {
  platformCookie,
  platformNoStoreHeaders,
  platformProblem,
  platformSessionCookieName,
  type PlatformAuthRuntime,
} from "./platform-auth-http";

const maximumResponseBytes = 1_048_576;
const maximumRequestBytes = 65_536;
const profileIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const etagPattern = /^"[1-9][0-9]*"$/u;

export interface AuthorizedRequest {
  readonly accessToken: SecretValue;
  readonly correlationId: string;
}

export async function authorize(
  request: Request,
  runtime: PlatformAuthRuntime,
  write: boolean,
): Promise<AuthorizedRequest | Response> {
  const handle = platformCookie(request, platformSessionCookieName(runtime.config));
  if (!handle) return platformProblem(401, "Unauthorized");
  try {
    const session = await runtime.auth.session(new SecretValue(handle));
    if (!session) return platformProblem(401, "Unauthorized");
    if (
      write &&
      (!validateRequestOrigin(runtime.config.origin, request.headers.get("origin")) ||
        !validateCsrf(session.csrfToken, request.headers.get("x-csrf-token")))
    ) {
      return platformProblem(403, "Request rejected");
    }
    return Object.freeze({ accessToken: session.accessToken, correlationId: crypto.randomUUID() });
  } catch {
    return platformProblem(503, "Session temporarily unavailable");
  }
}

function isResponse(value: AuthorizedRequest | Response): value is Response {
  return value instanceof Response;
}

async function boundedBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > maximumRequestBytes) {
    throw new Error("Request body is too large");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumRequestBytes) {
    throw new Error("Request body is too large");
  }
  return JSON.parse(body) as unknown;
}

function upstreamProblem(status: number, conflictTitle?: string): Response {
  const titles: Readonly<Record<number, string>> = {
    400: "Invalid request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Tenant profile not found",
    409: conflictTitle ?? "The operation conflicts with the current tenant profile state",
    412: "Tenant profile changed; reload and try again",
    428: "A current tenant profile version is required",
  };
  return platformProblem(status in titles ? status : 503, titles[status] ?? "Platform unavailable");
}

async function readUpstream(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > maximumResponseBytes) {
    throw new Error("Response body is too large");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maximumResponseBytes) {
    throw new Error("Response body is too large");
  }
  return JSON.parse(body) as unknown;
}

function responseWithEtag(body: unknown, upstream: Response): Response {
  const headers = platformNoStoreHeaders();
  const etag = upstream.headers.get("etag");
  if (etag && etagPattern.test(etag)) headers.set("etag", etag);
  return Response.json(body, { status: upstream.status, headers });
}

function listQuery(request: Request): URLSearchParams | null {
  const input = new URL(request.url).searchParams;
  const allowed = new Set(["status", "serverId", "releaseId", "search", "cursor", "pageSize"]);
  const raw: Record<string, string> = {};
  for (const key of input.keys()) {
    if (!allowed.has(key) || input.getAll(key).length !== 1) return null;
    const value = input.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = TenantProfileListQuerySchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = new URLSearchParams();
  if (parsed.data.status) output.set("status", parsed.data.status);
  if (parsed.data.serverId) output.set("serverId", parsed.data.serverId);
  if (parsed.data.releaseId) output.set("releaseId", parsed.data.releaseId);
  if (parsed.data.search) output.set("search", parsed.data.search);
  if (parsed.data.cursor) output.set("cursor", parsed.data.cursor);
  output.set("pageSize", parsed.data.pageSize.toString());
  return output;
}

export async function handleTenantProfileList(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const query = listQuery(request);
  if (!query) return platformProblem(400, "Invalid request");
  const authorization = await authorize(request, runtime, false);
  if (isResponse(authorization)) return authorization;
  try {
    const target = new URL("/api/v1/tenant-profiles", runtime.config.adminApiOrigin);
    target.search = query.toString();
    const upstream = await runtime.platformApiFetch(target, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authorization.accessToken.expose()}`,
        "x-correlation-id": authorization.correlationId,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    if (!upstream.ok) return upstreamProblem(upstream.status);
    return Response.json(TenantProfileListResponseSchema.parse(await readUpstream(upstream)), {
      headers: platformNoStoreHeaders(),
    });
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleTenantProfileCreate(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  let candidate: unknown;
  try {
    candidate = await boundedBody(request);
  } catch {
    return platformProblem(400, "Invalid request");
  }
  const parsed = CreateTenantProfileSchema.safeParse(candidate);
  if (!parsed.success) return platformProblem(400, "Invalid request");
  try {
    const upstream = await runtime.platformApiFetch(
      new URL("/api/v1/tenant-profiles", runtime.config.adminApiOrigin),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "content-type": "application/json",
          "x-correlation-id": authorization.correlationId,
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status, "Tenant profile already exists");
    const body = TenantProfileResponseSchema.parse(await readUpstream(upstream));
    return responseWithEtag(body, upstream);
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleLatestTenantDecommissioning(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const authorization = await authorize(request, runtime, false);
  if (isResponse(authorization)) return authorization;
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(
        `/api/v1/tenant-profiles/${id}/decommissioning-operations/latest`,
        runtime.config.adminApiOrigin,
      ),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "x-correlation-id": authorization.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    return Response.json(
      DecommissioningOperationResponseSchema.parse(await readUpstream(upstream)),
      { headers: platformNoStoreHeaders() },
    );
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleLatestTenantProvisioning(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const authorization = await authorize(request, runtime, false);
  if (isResponse(authorization)) return authorization;
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(
        `/api/v1/tenant-profiles/${id}/provisioning-operations/latest`,
        runtime.config.adminApiOrigin,
      ),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "x-correlation-id": authorization.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    return Response.json(ProvisioningOperationResponseSchema.parse(await readUpstream(upstream)), {
      headers: platformNoStoreHeaders(),
    });
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleTenantProfileGet(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const authorization = await authorize(request, runtime, false);
  if (isResponse(authorization)) return authorization;
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(`/api/v1/tenant-profiles/${id}`, runtime.config.adminApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "x-correlation-id": authorization.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    const body = TenantProfileResponseSchema.parse(await readUpstream(upstream));
    return responseWithEtag(body, upstream);
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleTenantProfileUpdate(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const ifMatch = request.headers.get("if-match");
  if (!ifMatch || !etagPattern.test(ifMatch)) {
    return platformProblem(428, "A current tenant profile version is required");
  }
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  let candidate: unknown;
  try {
    candidate = await boundedBody(request);
  } catch {
    return platformProblem(400, "Invalid request");
  }
  const parsed = UpdateTenantProfileSchema.safeParse(candidate);
  if (!parsed.success) return platformProblem(400, "Invalid request");
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(`/api/v1/tenant-profiles/${id}`, runtime.config.adminApiOrigin),
      {
        method: "PATCH",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "content-type": "application/json",
          "if-match": ifMatch,
          "x-correlation-id": authorization.correlationId,
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    const body = TenantProfileResponseSchema.parse(await readUpstream(upstream));
    return responseWithEtag(body, upstream);
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handlePendingTenantProfileDeletion(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const ifMatch = request.headers.get("if-match");
  if (!ifMatch || !etagPattern.test(ifMatch)) {
    return platformProblem(428, "A current tenant profile version is required");
  }
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  let candidate: unknown;
  try {
    candidate = await boundedBody(request);
  } catch {
    return platformProblem(400, "Invalid request");
  }
  const parsed = ConfirmTenantProfileDeletionSchema.safeParse(candidate);
  if (!parsed.success) return platformProblem(400, "Invalid request");
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(`/api/v1/tenant-profiles/${id}`, runtime.config.adminApiOrigin),
      {
        method: "DELETE",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "content-type": "application/json",
          "if-match": ifMatch,
          "x-correlation-id": authorization.correlationId,
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    return new Response(null, { status: 204, headers: platformNoStoreHeaders() });
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleTenantDecommissioningRequest(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const ifMatch = request.headers.get("if-match");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!ifMatch || !etagPattern.test(ifMatch)) {
    return platformProblem(428, "A current tenant profile version is required");
  }
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) {
    return platformProblem(400, "Invalid request");
  }
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  let candidate: unknown;
  try {
    candidate = await boundedBody(request);
  } catch {
    return platformProblem(400, "Invalid request");
  }
  const parsed = RequestTenantDecommissioningSchema.safeParse(candidate);
  if (!parsed.success) return platformProblem(400, "Invalid request");
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(
        `/api/v1/tenant-profiles/${id}/decommissioning-operations`,
        runtime.config.adminApiOrigin,
      ),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "content-type": "application/json",
          "if-match": ifMatch,
          "idempotency-key": idempotencyKey,
          "x-correlation-id": authorization.correlationId,
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!upstream.ok) {
      return upstreamProblem(
        upstream.status,
        "El perfil tiene otra operaciÃ³n activa. Actualiza el estado e intenta nuevamente.",
      );
    }
    return new Response(await upstream.text(), {
      status: 202,
      headers: {
        ...platformNoStoreHeaders(),
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        ...(upstream.headers.get("x-tenant-profile-etag")
          ? { "x-tenant-profile-etag": upstream.headers.get("x-tenant-profile-etag")! }
          : {}),
      },
    });
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleActivationDelivery(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const ifMatch = request.headers.get("if-match");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!ifMatch || !etagPattern.test(ifMatch)) {
    return platformProblem(428, "A current tenant profile version is required");
  }
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) {
    return platformProblem(400, "Invalid request");
  }
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(`/api/v1/tenant-profiles/${id}/activation-deliveries`, runtime.config.adminApiOrigin),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "content-type": "application/json",
          "if-match": ifMatch,
          "idempotency-key": idempotencyKey,
          "x-correlation-id": authorization.correlationId,
        },
        body: "{}",
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(40_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    const response = ActivationDeliveryResponseSchema.parse(await readUpstream(upstream));
    const headers = platformNoStoreHeaders();
    headers.set("referrer-policy", "no-referrer");
    return Response.json(response, { headers });
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleTenantReleasePromotion(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const ifMatch = request.headers.get("if-match");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    !ifMatch ||
    !etagPattern.test(ifMatch) ||
    !idempotencyKey ||
    !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)
  )
    return platformProblem(400, "Invalid request");
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  let candidate: unknown;
  try {
    candidate = await boundedBody(request);
  } catch {
    return platformProblem(400, "Invalid request");
  }
  const parsed = RequestTenantReleasePromotionSchema.safeParse(candidate);
  if (!parsed.success) return platformProblem(400, "Invalid request");
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(`/api/v1/tenant-profiles/${id}/release-promotions`, runtime.config.adminApiOrigin),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "content-type": "application/json",
          "if-match": ifMatch,
          "idempotency-key": idempotencyKey,
          "x-correlation-id": authorization.correlationId,
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    const body = TenantReleasePromotionResponseSchema.parse(await readUpstream(upstream));
    return responseWithEtag(body, upstream);
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleTenantProvisioningRequest(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const ifMatch = request.headers.get("if-match");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    !ifMatch ||
    !etagPattern.test(ifMatch) ||
    !idempotencyKey ||
    !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)
  ) {
    return platformProblem(400, "Invalid request");
  }
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  let candidate: unknown;
  try {
    candidate = await boundedBody(request);
  } catch {
    return platformProblem(400, "Invalid request");
  }
  const parsed = RequestTenantProvisioningSchema.safeParse(candidate);
  if (!parsed.success) return platformProblem(400, "Invalid request");
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(
        `/api/v1/tenant-profiles/${id}/provisioning-operations`,
        runtime.config.adminApiOrigin,
      ),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "content-type": "application/json",
          "if-match": ifMatch,
          "idempotency-key": idempotencyKey,
          "x-correlation-id": authorization.correlationId,
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    const body = ProvisioningOperationResponseSchema.parse(await readUpstream(upstream));
    const headers = platformNoStoreHeaders();
    const tenantEtag = upstream.headers.get("x-tenant-profile-etag");
    if (tenantEtag && etagPattern.test(tenantEtag)) {
      headers.set("x-tenant-profile-etag", tenantEtag);
    }
    return Response.json(body, { status: upstream.status, headers });
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleAutomaticTenantProvisioningRequest(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!profileIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const ifMatch = request.headers.get("if-match");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    !ifMatch ||
    !etagPattern.test(ifMatch) ||
    !idempotencyKey ||
    !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)
  ) {
    return platformProblem(400, "Invalid request");
  }
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  let candidate: unknown;
  try {
    candidate = await boundedBody(request);
  } catch {
    return platformProblem(400, "Invalid request");
  }
  if (!RequestAutomaticTenantProvisioningSchema.safeParse(candidate).success) {
    return platformProblem(400, "Invalid request");
  }
  try {
    const upstream = await runtime.platformApiFetch(
      new URL(
        `/api/v1/tenant-profiles/${id}/provisioning-operations/automatic`,
        runtime.config.adminApiOrigin,
      ),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorization.accessToken.expose()}`,
          "content-type": "application/json",
          "if-match": ifMatch,
          "idempotency-key": idempotencyKey,
          "x-correlation-id": authorization.correlationId,
        },
        body: "{}",
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    const body = ProvisioningOperationResponseSchema.parse(await readUpstream(upstream));
    const headers = platformNoStoreHeaders();
    const tenantEtag = upstream.headers.get("x-tenant-profile-etag");
    if (tenantEtag && etagPattern.test(tenantEtag)) {
      headers.set("x-tenant-profile-etag", tenantEtag);
    }
    return Response.json(body, { status: upstream.status, headers });
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}
