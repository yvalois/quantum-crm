import { describe, expect, it } from "vitest";

import { ADMIN_TENANTS_RETURN_TO, adminLoginPath } from "./admin-session-client";

describe("admin session navigation", () => {
  it("returns to the tenant administration after reauthentication", () => {
    expect(adminLoginPath()).toBe(
      `/api/auth/login?returnTo=${encodeURIComponent(ADMIN_TENANTS_RETURN_TO)}`,
    );
  });

  it("encodes an explicit return path without exposing it as another query parameter", () => {
    expect(adminLoginPath("/dashboard/tenants?search=InterAmerican&status=ACTIVE")).toBe(
      "/api/auth/login?returnTo=%2Fdashboard%2Ftenants%3Fsearch%3DInterAmerican%26status%3DACTIVE",
    );
  });
});
