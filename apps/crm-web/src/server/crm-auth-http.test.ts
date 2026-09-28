import { SecretValue, type CrmWebAuthConfig } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import type { CrmAuthRuntime } from "./crm-auth-http.js";
import {
  handleCrmCallback,
  handleCrmMemberDeactivation,
  handleCrmMemberInvitation,
  handleCrmMemberInvitationRevocation,
  handleCrmLogin,
  handleCrmMemberList,
  handleCrmMemberUpdate,
  handleCrmContactUpdate,
  handleCrmSession,
} from "./crm-auth-http.js";

const config: CrmWebAuthConfig = {
  schemaVersion: "crm-web-auth-config/v1",
  environment: "production",
  origin: "https://crm.example.test",
  crmApiOrigin: "http://api:3001",
  issuer: "https://identity.example.test/realms/acme-colombia",
  clientId: "quantum-crm-web",
  clientSecret: new SecretValue("synthetic-client-secret"),
  redisUrl: new SecretValue("rediss://session-user:synthetic@redis:6379/1"),
  sessionNamespace: "crm:01995f7e-7b52-7000-8000-000000000101",
  callbackUrl: "https://crm.example.test/api/auth/callback/keycloak",
  signedOutUrl: "https://crm.example.test/signed-out",
  requiredAcr: "2",
  loginTransactionTtlSeconds: 300,
  sessionIdleTtlSeconds: 1800,
  sessionAbsoluteTtlSeconds: 28800,
  secureCookies: true,
  tenantId: "01995f7e-7b52-7000-8000-000000000101",
};
const loginHandle = new SecretValue("a".repeat(43));
const sessionHandle = new SecretValue("b".repeat(43));
const csrfToken = "c".repeat(43);

function runtime(crmApiFetch: typeof fetch = vi.fn(fetch)): CrmAuthRuntime {
  return {
    config,
    crmApiFetch,
    auth: {
      beginLogin: vi.fn(async () => ({
        authorizationUrl: new URL("https://identity.example.test/authorize?state=opaque"),
        transactionHandle: loginHandle,
      })),
      completeLogin: vi.fn(async () => ({ returnTo: "/", sessionHandle })),
      logout: vi.fn(async () => undefined),
      session: vi.fn(async () => ({
        subject: "crm-member",
        accessToken: new SecretValue("server-only-access-token"),
        accessTokenExpiresAt: new Date("2026-09-20T15:05:00.000Z"),
        refreshToken: new SecretValue("server-only-refresh-token"),
        idToken: new SecretValue("server-only-id-token"),
        csrfToken,
        authenticatedAt: new Date("2026-09-20T15:00:00.000Z"),
        createdAt: new Date("2026-09-20T15:00:00.000Z"),
        lastSeenAt: new Date("2026-09-20T15:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-09-20T23:00:00.000Z"),
      })),
    },
  };
}

describe("CRM web authentication HTTP boundary", () => {
  it("uses a host-only opaque login cookie", async () => {
    const response = await handleCrmLogin(
      new Request("https://crm.example.test/api/auth/login?returnTo=%2Fmembers"),
      runtime(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toContain(
      `__Host-qcrm_crm_login=${loginHandle.expose()}; Path=/; Max-Age=300; HttpOnly; SameSite=Lax; Secure`,
    );
  });

  it("sets a server session and never returns provider tokens", async () => {
    const response = await handleCrmCallback(
      new Request(`${config.callbackUrl}?code=synthetic&state=opaque`, {
        headers: { cookie: `__Host-qcrm_crm_login=${loginHandle.expose()}` },
      }),
      runtime(),
    );
    const headers = [...response.headers.entries()].join("\n");

    expect(response.status).toBe(303);
    expect(headers).toContain(`__Host-qcrm_crm_session=${sessionHandle.expose()}`);
    expect(headers).not.toContain("server-only-access-token");
  });

  it("returns only session metadata and validated member data", async () => {
    const member = {
      id: "01995f7e-7b52-7000-8000-000000000102",
      displayName: "Ada Lovelace",
      email: "ada@example.test",
      status: "ACTIVE",
      authorizationRevision: "1",
      createdAt: "2026-09-20T15:00:00.000Z",
      updatedAt: "2026-09-20T15:00:00.000Z",
      deactivatedAt: null,
    };
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: [member], page: { nextCursor: null } }),
    );
    const request = new Request("https://crm.example.test/api/members?limit=25", {
      headers: { cookie: `__Host-qcrm_crm_session=${sessionHandle.expose()}` },
    });
    const memberResponse = await handleCrmMemberList(request, runtime(upstream as typeof fetch));
    const sessionResponse = await handleCrmSession(
      new Request("https://crm.example.test/api/auth/session", {
        headers: { cookie: `__Host-qcrm_crm_session=${sessionHandle.expose()}` },
      }),
      runtime(),
    );

    expect(upstream.mock.calls[0]?.[0].toString()).toBe("http://api:3001/api/v1/members?limit=25");
    expect(upstream.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer server-only-access-token",
    });
    expect(await memberResponse.text()).not.toContain("server-only-access-token");
    expect(await sessionResponse.text()).not.toContain("server-only-access-token");
  });

  it("rejects arbitrary BFF routes before calling CRM API", async () => {
    const upstream = vi.fn(fetch);
    const response = await handleCrmMemberList(
      new Request("https://crm.example.test/api/members?target=https://attacker.test", {
        headers: { cookie: `__Host-qcrm_crm_session=${sessionHandle.expose()}` },
      }),
      runtime(upstream),
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards a validated invitation with server-only credentials", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        data: {
          id: "01995f7e-7b52-7000-8000-000000000103",
          memberId: "01995f7e-7b52-7000-8000-000000000102",
          status: "PENDING",
          expiresAt: "2026-09-27T15:00:00.000Z",
          acceptedAt: null,
          createdAt: "2026-09-20T15:00:00.000Z",
        },
      }),
    );
    const response = await handleCrmMemberInvitation(
      new Request("https://crm.example.test/api/members/invitations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `__Host-qcrm_crm_session=${sessionHandle.expose()}`,
          "idempotency-key": "invite-00000001",
          origin: config.origin,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          displayName: "Ada Lovelace",
          email: "ADA@EXAMPLE.TEST",
          roleCode: "ADVISOR",
        }),
      }),
      runtime(upstream as typeof fetch),
    );

    expect(upstream).toHaveBeenCalledOnce();
    const [target, init] = upstream.mock.calls[0]!;
    expect(response.status).toBe(200);
    expect(target.toString()).toBe("http://api:3001/api/v1/members/invitations");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-only-access-token");
    expect(new Headers(init?.headers).get("idempotency-key")).toBe("invite-00000001");
    expect(init?.body).toBe(
      JSON.stringify({
        displayName: "Ada Lovelace",
        email: "ada@example.test",
        roleCode: "ADVISOR",
      }),
    );
    expect(await response.text()).not.toContain("server-only-access-token");
  });

  it("rejects member mutations without a same-origin CSRF-protected request", async () => {
    const upstream = vi.fn(fetch);
    const response = await handleCrmMemberUpdate(
      new Request("https://crm.example.test/api/members/01995f7e-7b52-7000-8000-000000000102", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: `__Host-qcrm_crm_session=${sessionHandle.expose()}`,
        },
        body: JSON.stringify({ displayName: "Ada Lovelace" }),
      }),
      runtime(upstream),
      "01995f7e-7b52-7000-8000-000000000102",
    );

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards an intentional contact-channel clear without converting it to an invalid value", async () => {
    const contact = {
      id: "01995f7e-7b52-7000-8000-000000000103",
      displayName: "Ada Lovelace",
      email: null,
      phone: null,
      version: "2",
      createdAt: "2026-09-20T15:00:00.000Z",
      updatedAt: "2026-09-20T15:01:00.000Z",
    };
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ data: contact }),
    );
    const response = await handleCrmContactUpdate(
      new Request(`https://crm.example.test/api/contacts/${contact.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: `__Host-qcrm_crm_session=${sessionHandle.expose()}`,
          origin: config.origin,
          "x-csrf-token": csrfToken,
          "if-match": '"1"',
        },
        body: JSON.stringify({ email: null, phone: null }),
      }),
      runtime(upstream as typeof fetch),
      contact.id,
    );

    expect(response.status).toBe(200);
    const [target, init] = upstream.mock.calls[0]!;
    expect(target.toString()).toBe(`http://api:3001/api/v1/contacts/${contact.id}`);
    expect(new Headers(init?.headers).get("if-match")).toBe('"1"');
    expect(init?.body).toBe(JSON.stringify({ email: null, phone: null }));
  });

  it("validates member IDs before forwarding a deactivation", async () => {
    const upstream = vi.fn(fetch);
    const response = await handleCrmMemberDeactivation(
      new Request("https://crm.example.test/api/members/not-a-member", {
        method: "DELETE",
        headers: {
          cookie: `__Host-qcrm_crm_session=${sessionHandle.expose()}`,
          origin: config.origin,
          "x-csrf-token": csrfToken,
        },
      }),
      runtime(upstream),
      "not-a-member",
    );

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards invitation revocation only after the same-origin CSRF check", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        data: {
          id: "01995f7e-7b52-7000-8000-000000000103",
          memberId: "01995f7e-7b52-7000-8000-000000000102",
          status: "REVOKED",
          expiresAt: "2026-09-27T15:00:00.000Z",
          acceptedAt: null,
          createdAt: "2026-09-20T15:00:00.000Z",
        },
      }),
    );
    const memberId = "01995f7e-7b52-7000-8000-000000000102";
    const response = await handleCrmMemberInvitationRevocation(
      new Request(`https://crm.example.test/api/members/${memberId}/invitation/revoke`, {
        method: "POST",
        headers: {
          cookie: `__Host-qcrm_crm_session=${sessionHandle.expose()}`,
          origin: config.origin,
          "x-csrf-token": csrfToken,
        },
      }),
      runtime(upstream as typeof fetch),
      memberId,
    );

    expect(response.status).toBe(200);
    expect(upstream.mock.calls[0]?.[0].toString()).toBe(
      `http://api:3001/api/v1/members/${memberId}/invitation/revoke`,
    );
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer server-only-access-token",
    );
  });
});
