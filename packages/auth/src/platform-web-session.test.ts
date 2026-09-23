import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it } from "vitest";

import {
  newCsrfToken,
  newOpaqueHandle,
  PlatformSessionError,
  safeReturnTo,
  sessionKey,
  validateCsrf,
  validateRequestOrigin,
} from "./platform-web-session.js";

describe("platform web session primitives", () => {
  it("creates opaque random handles and stores only their digest in keys", () => {
    const first = newOpaqueHandle();
    const second = newOpaqueHandle();
    const key = sessionKey("platform", "session", first);

    expect(first.expose()).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second.expose()).not.toBe(first.expose());
    expect(key).toMatch(/^qcrm:platform:session:v1:[A-Za-z0-9_-]{43}$/u);
    expect(key).not.toContain(first.expose());
  });

  it("separates the same opaque handle between platform and CRM namespaces", () => {
    const handle = newOpaqueHandle();

    expect(sessionKey("platform", "session", handle)).not.toBe(
      sessionKey("crm:01995f7e-7b52-7000-8000-000000000101", "session", handle),
    );
  });

  it("rejects malformed session handles", () => {
    expect(() => sessionKey("platform", "session", new SecretValue("predictable"))).toThrow(
      PlatformSessionError,
    );
  });

  it.each([
    [undefined, "/"],
    ["/tenants?status=active", "/tenants?status=active"],
    ["https://attacker.test", "/"],
    ["//attacker.test", "/"],
    ["/\\attacker.test", "/"],
    [`/${"a".repeat(513)}`, "/"],
  ])("normalizes a return target without permitting redirects off site", (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });

  it("validates CSRF tokens without accepting malformed values", () => {
    const token = newCsrfToken();
    expect(validateCsrf(token, token)).toBe(true);
    expect(validateCsrf(token, newCsrfToken())).toBe(false);
    expect(validateCsrf(token, null)).toBe(false);
    expect(validateCsrf(token, "short")).toBe(false);
  });

  it("requires the exact configured Origin", () => {
    expect(validateRequestOrigin("https://admin.example.test", "https://admin.example.test")).toBe(
      true,
    );
    expect(
      validateRequestOrigin("https://admin.example.test", "https://admin.example.test.evil.test"),
    ).toBe(false);
    expect(validateRequestOrigin("https://admin.example.test", null)).toBe(false);
  });
});
