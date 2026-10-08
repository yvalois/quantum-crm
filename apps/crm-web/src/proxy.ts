import { type NextRequest, NextResponse } from "next/server";

import { siblingStorageOrigin } from "./server/storage-origin";

function contentSecurityPolicy(nonce: string, filesOrigin: string | null): string {
  const filesSource = filesOrigin ? ` ${filesOrigin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' blob: data:${filesSource}`,
    "font-src 'self'",
    `connect-src 'self'${filesSource}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, siblingStorageOrigin(request.url, request.headers));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const hasSession =
    request.cookies.has("__Host-qcrm_crm_session") || request.cookies.has("qcrm_crm_session");
  const isPublic =
    request.nextUrl.pathname === "/signed-out" || request.nextUrl.pathname.startsWith("/f/");
  const response =
    !isPublic && !hasSession
      ? redirectToLogin(request)
      : NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

function redirectToLogin(request: NextRequest): NextResponse {
  const login = new URL("/api/auth/login", request.url);
  login.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
