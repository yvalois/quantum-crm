import type { AdminWebAuthConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";
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
}

function cookieNames(config: AdminWebAuthConfig): {
  readonly login: string;
  readonly session: string;
} {
  const prefix = config.secureCookies ? "__Host-" : "";
  return {
    login: `${prefix}qcrm_admin_login`,
    session: `${prefix}qcrm_admin_session`,
  };
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

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function noStoreHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
  });
}

function problem(status: number, title: string): Response {
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
  const headers = noStoreHeaders();
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
    return problem(503, "Authentication temporarily unavailable");
  }
}

export async function handlePlatformCallback(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const names = cookieNames(runtime.config);
  const transactionHandle = cookie(request, names.login);
  const clearLogin = serializeCookie(names.login, "", {
    maxAge: 0,
    secure: runtime.config.secureCookies,
  });
  if (!transactionHandle) {
    const response = problem(400, "Invalid authentication response");
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
    const headers = noStoreHeaders();
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
    const response = problem(401, "Authentication failed");
    response.headers.append("set-cookie", clearLogin);
    return response;
  }
}

export async function handlePlatformSession(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const sessionHandle = cookie(request, cookieNames(runtime.config).session);
  if (!sessionHandle) {
    return Response.json({ authenticated: false }, { status: 401, headers: noStoreHeaders() });
  }

  try {
    const session = await runtime.auth.session(new SecretValue(sessionHandle));
    if (!session) {
      return Response.json({ authenticated: false }, { status: 401, headers: noStoreHeaders() });
    }
    return Response.json(
      {
        authenticated: true,
        csrfToken: session.csrfToken,
        authenticatedAt: session.authenticatedAt.toISOString(),
      },
      { headers: noStoreHeaders() },
    );
  } catch {
    return problem(503, "Session temporarily unavailable");
  }
}

export async function handlePlatformLogout(
  request: Request,
  runtime: PlatformAuthRuntime,
): Promise<Response> {
  const names = cookieNames(runtime.config);
  const sessionHandle = cookie(request, names.session);
  if (
    !sessionHandle ||
    !validateRequestOrigin(runtime.config.origin, request.headers.get("origin"))
  ) {
    return problem(403, "Request rejected");
  }

  try {
    const protectedHandle = new SecretValue(sessionHandle);
    const session = await runtime.auth.session(protectedHandle);
    if (!session || !validateCsrf(session.csrfToken, request.headers.get("x-csrf-token"))) {
      return problem(403, "Request rejected");
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
    return problem(503, "Session temporarily unavailable");
  }
}
