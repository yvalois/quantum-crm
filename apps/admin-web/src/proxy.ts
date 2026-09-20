import { type NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest): NextResponse {
  const hasSession =
    request.cookies.has("__Host-qcrm_admin_session") || request.cookies.has("qcrm_admin_session");
  if (hasSession) return NextResponse.next();

  const login = new URL("/api/auth/login", request.url);
  login.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
