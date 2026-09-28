import type { AdminWebAuthConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";
import { PlatformOperatorSelfSchema } from "@quantum-crm/contracts";
import {
  type PlatformWebAuthService,
  validateCsrf,
  validateRequestOrigin,
} from "@quantum-crm/auth";

export interface PlatformAuthRuntime {
  readonly config: AdminWebAuthConfig;
  readonly auth: Pick<
    PlatformWebAuthService,
    "beginLogin" | "completeLogin" | "logout" | "session"
  >;
  readonly platformApiFetch: typeof fetch;
}

export function platformSessionCookieName(config: AdminWebAuthConfig): string {
  return `${config.secureCookies ? "__Host-" : ""}qcrm_admin_session`;
}

function cookieNames(config: AdminWebAuthConfig): {
  readonly login: string;
  readonly session: string;
} {
  const prefix = config.secureCookies ? "__Host-" : "";
  return {
    login: `${prefix}qcrm_admin_login`,
    session: platformSessionCookieName(config),
  };
}

export async function handlePlatformOperatorMe(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const sessionHandle = platformCookie(request, platformSessionCookieName(runtime.config));
  if (!sessionHandle) return platformProblem(401, "Unauthorized");

  try {
    const session = await runtime.auth.session(new SecretValue(sessionHandle));
    if (!session) return platformProblem(401, "Unauthorized");

    const response = await runtime.platformApiFetch(
      new URL("/api/v1/operators/me", runtime.config.adminApiOrigin),
      {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${session.accessToken.expose()}`,
          "x-correlation-id": crypto.randomUUID(),
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (response.status === 401) return platformProblem(401, "Unauthorized");
    if (response.status === 403) return platformProblem(403, "Forbidden");
    if (!response.ok) return platformProblem(503, "Platform service temporarily unavailable");
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > 65_536)
      return platformProblem(503, "Platform service temporarily unavailable");
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > 65_536) {
      return platformProblem(503, "Platform service temporarily unavailable");
    }
    const parsed = PlatformOperatorSelfSchema.parse(JSON.parse(body) as unknown);
    return Response.json(parsed, { headers: platformNoStoreHeaders() });
  } catch {
    return platformProblem(503, "Platform service temporarily unavailable");
  }
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

export function platformCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

export function platformNoStoreHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
  });
}

export function platformProblem(status: number, title: string): Response {
  return Response.json(
    {
      type: "about:blank",
      title,
      status,
    },
    {
      status,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/problem+json",
      },
    },
  );
}

function redirect(location: string, cookieHeader?: string): Response {
  const headers = platformNoStoreHeaders();
  headers.set("location", location);
  if (cookieHeader) headers.append("set-cookie", cookieHeader);
  return new Response(null, { status: 303, headers });
}

export async function handlePlatformLogin(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  try {
    const returnTo = new URL(request.url).searchParams.get("returnTo");
    const started = await runtime.auth.beginLogin(returnTo);
    const names = cookieNames(runtime.config);
    return redirect(
      started.authorizationUrl.toString(),
      serializeCookie(names.login, started.transactionHandle.expose(), {
        maxAge: runtime.config.loginTransactionTtlSeconds,
        secure: runtime.config.secureCookies,
      }),
    );
  } catch {
    return platformProblem(503, "Authentication temporarily unavailable");
  }
}

export async function handlePlatformCallback(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const names = cookieNames(runtime.config);
  const transactionHandle = platformCookie(request, names.login);
  const clearLogin = serializeCookie(names.login, "", {
    maxAge: 0,
    secure: runtime.config.secureCookies,
  });
  if (!transactionHandle) {
    return redirect(
      new URL("/api/auth/login?returnTo=%2Fdashboard", runtime.config.origin).toString(),
      clearLogin,
    );
  }

  try {
    const received = new URL(request.url);
    const callback = new URL(runtime.config.callbackUrl);
    callback.search = received.search;
    const completed = await runtime.auth.completeLogin(
      callback,
      new SecretValue(transactionHandle),
    );
    const headers = platformNoStoreHeaders();
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
    const response = platformProblem(401, "Authentication failed");
    response.headers.append("set-cookie", clearLogin);
    return response;
  }
}

export async function handlePlatformSession(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const sessionHandle = platformCookie(request, cookieNames(runtime.config).session);
  if (!sessionHandle) {
    return Response.json(
      { authenticated: false },
      { status: 401, headers: platformNoStoreHeaders() },
    );
  }

  try {
    const session = await runtime.auth.session(new SecretValue(sessionHandle));
    if (!session) {
      return Response.json(
        { authenticated: false },
        { status: 401, headers: platformNoStoreHeaders() },
      );
    }
    return Response.json(
      {
        authenticated: true,
        csrfToken: session.csrfToken,
        authenticatedAt: session.authenticatedAt.toISOString(),
      },
      { headers: platformNoStoreHeaders() },
    );
  } catch {
    return platformProblem(503, "Session temporarily unavailable");
  }
}

export async function handlePlatformLogout(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const names = cookieNames(runtime.config);
  const sessionHandle = platformCookie(request, names.session);
  if (
    !sessionHandle ||
    !validateRequestOrigin(runtime.config.origin, request.headers.get("origin"))
  ) {
    return platformProblem(403, "Request rejected");
  }

  try {
    const protectedHandle = new SecretValue(sessionHandle);
    const session = await runtime.auth.session(protectedHandle);
    if (!session || !validateCsrf(session.csrfToken, request.headers.get("x-csrf-token"))) {
      return platformProblem(403, "Request rejected");
    }
    await runtime.auth.logout(protectedHandle);
    return redirect(
      runtime.config.signedOutUrl,
      serializeCookie(names.session, "", {
        maxAge: 0,
        secure: runtime.config.secureCookies,
      }),
    );
  } catch {
    return platformProblem(503, "Session temporarily unavailable");
  }
}
