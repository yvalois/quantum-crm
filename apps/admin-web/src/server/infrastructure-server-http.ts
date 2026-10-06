import {
  InfrastructureServerListQuerySchema,
  InfrastructureServerListResponseSchema,
} from "@quantum-crm/contracts";

import { authorize, type AuthorizedRequest } from "./tenant-profile-http";
import {
  platformNoStoreHeaders,
  platformProblem,
  type PlatformAuthRuntime,
} from "./platform-auth-http";

const maximumResponseBytes = 1_048_576;

function isResponse(value: AuthorizedRequest | Response): value is Response {
  return value instanceof Response;
}

function listQuery(request: Request): URLSearchParams | null {
  const input = new URL(request.url).searchParams;
  const raw: Record<string, string> = {};
  for (const key of input.keys()) {
    if (!new Set(["status", "pageSize"]).has(key) || input.getAll(key).length !== 1) return null;
    const value = input.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = InfrastructureServerListQuerySchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = new URLSearchParams({ pageSize: parsed.data.pageSize.toString() });
  if (parsed.data.status) output.set("status", parsed.data.status);
  return output;
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

export async function handleInfrastructureServerList(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const query = listQuery(request);
  if (!query) return platformProblem(400, "Invalid request");
  const authorization = await authorize(request, runtime, false);
  if (isResponse(authorization)) return authorization;
  try {
    const target = new URL("/api/v1/infrastructure-servers", runtime.config.adminApiOrigin);
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
    if (!upstream.ok) {
      const status = [400, 401, 403].includes(upstream.status) ? upstream.status : 503;
      return platformProblem(status, status === 403 ? "Forbidden" : "Platform unavailable");
    }
    return Response.json(
      InfrastructureServerListResponseSchema.parse(await readUpstream(upstream)),
      { headers: platformNoStoreHeaders() },
    );
  } catch {
    return platformProblem(503, "Platform unavailable");
  }
}
