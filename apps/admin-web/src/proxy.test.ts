import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

describe("admin web proxy", () => {
  it("redirects an unauthenticated dashboard request and returns a strict CSP", () => {
    const response = proxy(new NextRequest("https://admin.example.test/dashboard?tab=health"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://admin.example.test/api/auth/login?returnTo=%2Fdashboard%3Ftab%3Dhealth",
    );
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("allows a session-bearing dashboard request without weakening browser headers", () => {
    const response = proxy(
      new NextRequest("https://admin.example.test/dashboard", {
        headers: { cookie: "__Host-qcrm_admin_session=opaque-handle" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("uses a fresh nonce for every rendered page request", () => {
    const first = proxy(new NextRequest("https://admin.example.test/"));
    const second = proxy(new NextRequest("https://admin.example.test/signed-out"));

    expect(first.headers.get("content-security-policy")).not.toBe(
      second.headers.get("content-security-policy"),
    );
  });
});
