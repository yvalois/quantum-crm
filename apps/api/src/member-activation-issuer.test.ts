import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemberActivationIssuer } from "./member-activation-issuer.js";

describe("member activation issuer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the tenant realm segment in token and activation requests", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "a".repeat(24) }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            subject: "01999abc-7def-7000-8000-000000000001",
            url: "https://identity.example.test/activate",
            temporaryPassword: "Aa9!temporary-password",
            expiresAt: "2026-10-08T01:30:00.000Z",
            generation: 1,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const issuer = createMemberActivationIssuer({
      tenantProfileId: "01999abc-7def-7000-8000-000000000002",
      identityIssuer: "https://identity.example.test/realms/tenant-one",
      clientId: "quantum-crm-bootstrap",
      clientSecret: "secret",
    });

    await issuer.issue({
      invitationId: "01999abc-7def-7000-8000-000000000003",
      email: "admin@example.test",
      displayName: "Administrador",
      generation: 1,
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://identity.example.test/realms/tenant-one/protocol/openid-connect/token",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://identity.example.test/realms/tenant-one/qcrm-internal/activation",
    );
  });
});
