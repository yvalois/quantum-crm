import {
  type PlatformWebAuthService,
  type PlatformWebSession,
  validateCsrf,
  validateRequestOrigin,
} from "@quantum-crm/auth";
import { type CrmWebAuthConfig, SecretValue } from "@quantum-crm/config";
import { MemberListQuerySchema, MemberListResponseSchema } from "@quantum-crm/contracts";

const maximumResponseBytes = 1_048_576;

export interface CrmAuthRuntime {
  readonly config: CrmWebAuthConfig;
  readonly auth: Pick<
    PlatformWebAuthService,
    "beginLogin" | "completeLogin" | "logout" | "session"
  >;
  readonly crmApiFetch: typeof fetch;
}

export function crmSessionCookieName(config: CrmWebAuthConfig): string {
  return `${config.secureCookies ? "__Host-" : ""}qcrm_crm_session`;
}

function cookieNames(config: CrmWebAuthConfig): {
  readonly login: string;
  readonly session: string;
} {
  const prefix = config.secureCookies ? "__Host-" : "";
  return {
    login: `${prefix}qcrm_crm_login`,
    session: crmSessionCookieName(config),
  };
}

export function crmCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

export function crmNoStoreHeaders(): Headers {
  return new Headers({ "cache-control": "no-store, max-age=0", pragma: "no-cache" });
}

export function crmProblem(status: number, title: string): Response {
  return Response.json(
    { type: "about:blank", title, status },
    {
      status,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/problem+json",
      },
    },
  );
}

function serializeCookie(
  name: string,
  value: string,
  input: { readonly maxAge: number; readonly secure: boolean },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${input.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(input.secure ? ["Secure"] : []),
  ].join("; ");
}

function redirect(location: string, cookieHeader?: string): Response {
  const headers = crmNoStoreHeaders();
  headers.set("location", location);
  if (cookieHeader) headers.append("set-cookie", cookieHeader);
  return new Response(null, { status: 303, headers });
}

interface AuthorizedCrmSession {
  readonly session: PlatformWebSession;
  readonly correlationId: string;
}

async function authorizedSession(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<AuthorizedCrmSession | Response> {
  const handle = crmCookie(request, crmSessionCookieName(runtime.config));
  if (!handle) return crmProblem(401, "Unauthorized");
  try {
    const session = await runtime.auth.session(new SecretValue(handle));
    if (!session) return crmProblem(401, "Unauthorized");
    return Object.freeze({ session, correlationId: crypto.randomUUID() });
  } catch {
    return crmProblem(503, "Session temporarily unavailable");
  }
}

function isResponse(value: AuthorizedCrmSession | Response): value is Response {
  return value instanceof Response;
}

function memberListQuery(request: Request): URLSearchParams | null {
  const input = new URL(request.url).searchParams;
  const allowed = new Set(["cursor", "limit", "status"]);
  const raw: Record<string, string> = {};
  for (const key of input.keys()) {
    if (!allowed.has(key) || input.getAll(key).length !== 1) return null;
    const value = input.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = MemberListQuerySchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = new URLSearchParams({ limit: parsed.data.limit.toString() });
  if (parsed.data.cursor) output.set("cursor", parsed.data.cursor);
  if (parsed.data.status) output.set("status", parsed.data.status);
  return output;
}

async function readBoundedJson(response: Response): Promise<unknown> {
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

export async function handleCrmLogin(request: Request, runtime: CrmAuthRuntime): Promise<Response> {
  try {
    const started = await runtime.auth.beginLogin(
      new URL(request.url).searchParams.get("returnTo"),
    );
    return redirect(
      started.authorizationUrl.toString(),
      serializeCookie(cookieNames(runtime.config).login, started.transactionHandle.expose(), {
        maxAge: runtime.config.loginTransactionTtlSeconds,
        secure: runtime.config.secureCookies,
      }),
    );
  } catch {
    return crmProblem(503, "Authentication temporarily unavailable");
  }
}

export async function handleCrmCallback(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const names = cookieNames(runtime.config);
  const transactionHandle = crmCookie(request, names.login);
  const clearLogin = serializeCookie(names.login, "", {
    maxAge: 0,
    secure: runtime.config.secureCookies,
  });
  if (!transactionHandle) {
    const response = crmProblem(400, "Invalid authentication response");
    response.headers.append("set-cookie", clearLogin);
    return response;
  }
  try {
    const received = new URL(request.url);
    const callback = new URL(runtime.config.callbackUrl);
    callback.search = received.search;
    const completed = await runtime.auth.completeLogin(
      callback,
      new SecretValue(transactionHandle),
    );
    const headers = crmNoStoreHeaders();
    headers.set("location", new URL(completed.returnTo, runtime.config.origin).toString());
    headers.append("set-cookie", clearLogin);
    headers.append(
      "set-cookie",
      serializeCookie(names.session, completed.sessionHandle.expose(), {
        maxAge: runtime.config.sessionAbsoluteTtlSeconds,
        secure: runtime.config.secureCookies,
      }),
    );
    return new Response(null, { status: 303, headers });
  } catch {
    const response = crmProblem(401, "Authentication failed");
    response.headers.append("set-cookie", clearLogin);
    return response;
  }
}

export async function handleCrmSession(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) {
    if (authorized.status === 401) {
      return Response.json({ authenticated: false }, { status: 401, headers: crmNoStoreHeaders() });
    }
    return authorized;
  }
  return Response.json(
    {
      authenticated: true,
      csrfToken: authorized.session.csrfToken,
      authenticatedAt: authorized.session.authenticatedAt.toISOString(),
    },
    { headers: crmNoStoreHeaders() },
  );
}

export async function handleCrmLogout(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const names = cookieNames(runtime.config);
  const handle = crmCookie(request, names.session);
  if (!handle || !validateRequestOrigin(runtime.config.origin, request.headers.get("origin"))) {
    return crmProblem(403, "Request rejected");
  }
  try {
    const protectedHandle = new SecretValue(handle);
    const session = await runtime.auth.session(protectedHandle);
    if (!session || !validateCsrf(session.csrfToken, request.headers.get("x-csrf-token"))) {
      return crmProblem(403, "Request rejected");
    }
    await runtime.auth.logout(protectedHandle);
    return redirect(
      runtime.config.signedOutUrl,
      serializeCookie(names.session, "", { maxAge: 0, secure: runtime.config.secureCookies }),
    );
  } catch {
    return crmProblem(503, "Session temporarily unavailable");
  }
}

export async function handleCrmMemberList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const query = memberListQuery(request);
  if (!query) return crmProblem(400, "Invalid request");
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const target = new URL("/api/v1/members", runtime.config.crmApiOrigin);
    target.search = query.toString();
    const upstream = await runtime.crmApiFetch(target, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authorized.session.accessToken.expose()}`,
        "x-correlation-id": authorized.correlationId,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    if (upstream.status === 401) return crmProblem(401, "Unauthorized");
    if (upstream.status === 403) return crmProblem(403, "Forbidden");
    if (!upstream.ok) return crmProblem(503, "CRM service temporarily unavailable");
    return Response.json(MemberListResponseSchema.parse(await readBoundedJson(upstream)), {
      headers: crmNoStoreHeaders(),
    });
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}
