import {
  PlatformReleaseListQuerySchema,
  PlatformReleaseListResponseSchema,
  PlatformReleaseResponseSchema,
  UpdatePlatformReleaseStatusSchema,
} from "@quantum-crm/contracts";

import {
  authorize,
  type AuthorizedRequest,
} from "./tenant-profile-http.js";
import {
  platformNoStoreHeaders,
  platformProblem,
  type PlatformAuthRuntime,
} from "./platform-auth-http.js";

const maximumResponseBytes = 1_048_576;
const maximumRequestBytes = 65_536;
const releaseIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const etagPattern = /^"[1-9][0-9]*"$/u;

function upstreamProblem(status: number): Response {
  const titles: Readonly<Record<number, string>> = {
    400: "Invalid request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Release not found",
    412: "Release changed; reload and try again",
    428: "A current release version is required",
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

function isResponse(value: AuthorizedRequest | Response): value is Response {
  return value instanceof Response;
}

function responseWithEtag(body: unknown, upstream: Response): Response {
  const headers = platformNoStoreHeaders();
  const etag = upstream.headers.get("etag");
  if (etag && etagPattern.test(etag)) headers.set("etag", etag);
  return Response.json(body, { status: upstream.status, headers });
}

function releaseQuery(request: Request): URLSearchParams | null {
  const input = new URL(request.url).searchParams;
  const allowed = new Set(["status", "pageSize"]);
  const raw: Record<string, string> = {};
  for (const key of input.keys()) {
    if (!allowed.has(key) || input.getAll(key).length !== 1) return null;
    const value = input.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = PlatformReleaseListQuerySchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = new URLSearchParams({ pageSize: parsed.data.pageSize.toString() });
  if (parsed.data.status) output.set("status", parsed.data.status);
  return output;
}

async function releaseRequest(
  runtime: PlatformAuthRuntime,
  authorization: AuthorizedRequest,
  init: RequestInit,
  path: string,
): Promise<Response> {
  return runtime.platformApiFetch(new URL(path, runtime.config.adminApiOrigin), {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${authorization.accessToken.expose()}`,
      "x-correlation-id": authorization.correlationId,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
}

export async function handleReleaseList(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const query = releaseQuery(request);
  if (!query) return platformProblem(400, "Invalid request");
  const authorization = await authorize(request, runtime, false);
  if (isResponse(authorization)) return authorization;
  try {
    const upstream = await releaseRequest(runtime, authorization, {}, `/api/v1/releases?${query}`);
    if (!upstream.ok) return upstreamProblem(upstream.status);
    return Response.json(PlatformReleaseListResponseSchema.parse(await readUpstream(upstream)), {
      headers: platformNoStoreHeaders(),
    });
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}

export async function handleReleaseStatusUpdate(
  request: Request,
  runtime: PlatformAuthRuntime,
  id: string,
): Promise<Response> {
  if (!releaseIdPattern.test(id)) return platformProblem(400, "Invalid request");
  const ifMatch = request.headers.get("if-match");
  if (!ifMatch || !etagPattern.test(ifMatch)) {
    return platformProblem(428, "A current release version is required");
  }
  const authorization = await authorize(request, runtime, true);
  if (isResponse(authorization)) return authorization;
  let candidate: unknown;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declaredLength) || declaredLength > maximumRequestBytes) {
      return platformProblem(400, "Invalid request");
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > maximumRequestBytes) {
      return platformProblem(400, "Invalid request");
    }
    candidate = JSON.parse(body) as unknown;
  } catch {
    return platformProblem(400, "Invalid request");
  }
  const parsed = UpdatePlatformReleaseStatusSchema.safeParse(candidate);
  if (!parsed.success) return platformProblem(400, "Invalid request");
  try {
    const upstream = await releaseRequest(
      runtime,
      authorization,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": ifMatch,
        },
        body: JSON.stringify(parsed.data),
      },
      `/api/v1/releases/${id}/status`,
    );
    if (!upstream.ok) return upstreamProblem(upstream.status);
    return responseWithEtag(PlatformReleaseResponseSchema.parse(await readUpstream(upstream)), upstream);
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}
