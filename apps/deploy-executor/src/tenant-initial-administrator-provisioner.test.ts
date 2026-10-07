import { afterEach, describe, expect, it, vi } from "vitest";

import { createTenantInitialAdministratorProvisioner } from "./tenant-initial-administrator-provisioner.js";

const tenantProfileId = "019b0000-0000-7000-8000-000000000101";
const subject = "019b0000-0000-7000-8000-000000000102";
const command = {
  tenantProfileId,
  email: "admin@example.test",
  displayName: "Initial Administrator",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provisioner() {
  return createTenantInitialAdministratorProvisioner({
    keycloakAdminOrigin: "http://platform-keycloak:8080",
    identityOrigin: "https://identity.example",
    keycloakProvisionerClientId: "quantum-provisioner",
    keycloakProvisionerClientSecret: "fixture",
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("tenant initial administrator provisioner", () => {
  it("reconciles only an exact existing administrator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(input.toString());
        if (url.pathname.endsWith("/protocol/openid-connect/token"))
          return response({ access_token: "a".repeat(24) });
        if (url.searchParams.has("email") || url.searchParams.has("username"))
          return response([{ id: subject }]);
        return response({
          id: subject,
          username: command.email,
          email: command.email,
          firstName: command.displayName,
          enabled: true,
          requiredActions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP"],
        });
      }),
    );

    await expect(provisioner().reconcile(command)).resolves.toEqual({ subject });
  });

  it("rejects a same-email user whose required actions were changed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(input.toString());
        if (url.pathname.endsWith("/protocol/openid-connect/token"))
          return response({ access_token: "a".repeat(24) });
        if (url.searchParams.has("email") || url.searchParams.has("username"))
          return response([{ id: subject }]);
        return response({
          id: subject,
          username: command.email,
          email: command.email,
          firstName: command.displayName,
          enabled: true,
          requiredActions: ["UPDATE_PASSWORD"],
        });
      }),
    );

    await expect(provisioner().reconcile(command)).rejects.toMatchObject({
      name: "TenantInitialAdministratorProvisioningError",
      reason: "TARGET_CONFLICT",
    });
  });

  it("issues activation through the public identity origin", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/protocol/openid-connect/token"))
        return response({ access_token: "a".repeat(24) });
      return response({
        url: `https://identity.example/realms/qcrm-019b0000000070008000000000000101/login-actions/action-token?key=opaque`,
        temporaryPassword: "Qq7!TemporaryPassword",
        expiresAt: "2026-10-01T00:00:00.000Z",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      provisioner().issueActivation({
        tenantProfileId,
        administratorSubject: subject,
        generation: 1,
      }),
    ).resolves.toMatchObject({
      url: expect.stringMatching(/^https:\/\/identity\.example\/realms\/qcrm-/u),
    });
    expect(fetchMock.mock.calls.map(([input]) => new URL(input.toString()).origin)).toEqual([
      "http://platform-keycloak:8080",
      "https://identity.example",
    ]);
  });

  it("rejects an activation URL returned for an internal or foreign origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(input.toString());
        if (url.pathname.endsWith("/protocol/openid-connect/token"))
          return response({ access_token: "a".repeat(24) });
        return response({
          url: `http://platform-keycloak:8080/realms/qcrm-019b0000000070008000000000000101/login-actions/action-token?key=opaque`,
          temporaryPassword: "Qq7!TemporaryPassword",
          expiresAt: "2026-10-01T00:00:00.000Z",
        });
      }),
    );

    await expect(
      provisioner().issueActivation({
        tenantProfileId,
        administratorSubject: subject,
        generation: 1,
      }),
    ).rejects.toMatchObject({ reason: "UNAVAILABLE" });
  });
});
