export const ADMIN_TENANTS_RETURN_TO = "/dashboard/tenants";

export function adminLoginPath(returnTo = ADMIN_TENANTS_RETURN_TO): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function redirectExpiredAdminSession(returnTo = ADMIN_TENANTS_RETURN_TO): void {
  window.location.replace(adminLoginPath(returnTo));
}

export function redirectIfAdminSessionExpired(
  response: Pick<Response, "status">,
  returnTo = ADMIN_TENANTS_RETURN_TO,
): boolean {
  if (response.status !== 401) return false;
  redirectExpiredAdminSession(returnTo);
  return true;
}

export async function adminCsrfToken(returnTo = ADMIN_TENANTS_RETURN_TO): Promise<string | null> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (redirectIfAdminSessionExpired(response, returnTo)) return null;
  if (!response.ok) throw new Error("No fue posible comprobar la sesión administrativa.");
  const body = (await response.json()) as { readonly csrfToken?: string };
  if (!body.csrfToken) throw new Error("La sesión no puede autorizar cambios.");
  return body.csrfToken;
}
