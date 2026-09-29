import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTenantIdentityProvisioner,
  TenantIdentityProvisioningError,
} from "../../apps/deploy-executor/src/tenant-identity-provisioner.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const keycloakAdminOrigin = process.env.QCRM_TEST_KEYCLOAK_ADMIN_ORIGIN;
const keycloakProvisionerClientSecret = process.env.QCRM_TEST_KEYCLOAK_PROVISIONER_CLIENT_SECRET;
const redisAdminUrl = process.env.QCRM_TEST_TENANT_REDIS_ADMIN_URL;
const integrationEnabled = Boolean(
  keycloakAdminOrigin && keycloakProvisionerClientSecret && redisAdminUrl,
);
const describeTenantIdentity = integrationEnabled ? describe : describe.skip;

const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const tenantC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const serverId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let secretDirectory = "";

function provisioner() {
  if (!keycloakAdminOrigin || !keycloakProvisionerClientSecret || !redisAdminUrl) {
    throw new Error("Tenant identity integration environment is incomplete");
  }
  return createTenantIdentityProvisioner({
    keycloakAdminOrigin,
    keycloakProvisionerClientId: "quantum-provisioner",
    keycloakProvisionerClientSecret,
    identityOrigin: "https://identity.example.test",
    redisAdminUrl,
    tenantSecretDirectory: secretDirectory,
  });
}

async function waitForKeycloak(): Promise<void> {
  if (!keycloakAdminOrigin) throw new Error("QCRM_TEST_KEYCLOAK_ADMIN_ORIGIN is required");
  const discoveryUrl = new URL(
    "/realms/master/.well-known/openid-configuration",
    keycloakAdminOrigin,
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(discoveryUrl)).ok) return;
    } catch {
      // Keycloak is still starting in the disposable integration network.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Disposable Keycloak did not become ready");
}

async function tenantRedisUrl(tenantProfileId: string): Promise<string> {
  return (
    await readFile(join(secretDirectory, tenantProfileId, "session-redis-url"), "utf8")
  ).trim();
}

describeTenantIdentity("tenant identity provisioner", () => {
  beforeAll(async () => {
    await waitForKeycloak();
    secretDirectory = await mkdtemp(join(tmpdir(), "qcrm-tenant-identity-"));
  }, 65_000);

  afterAll(async () => {
    if (secretDirectory) await rm(secretDirectory, { force: true, recursive: true });
  });

  it("creates isolated Keycloak and Redis identities, then reconciles a retry", async () => {
    const subject = provisioner();
    const firstA = await subject.provision({
      tenantProfileId: tenantA,
      serverId,
      hostname: "tenant-a.127-0-0-1.nip.io",
    });
    const firstB = await subject.provision({
      tenantProfileId: tenantB,
      serverId,
      hostname: "tenant-b.127-0-0-1.nip.io",
    });
    const retryA = await subject.provision({
      tenantProfileId: tenantA,
      serverId,
      hostname: "tenant-a.127-0-0-1.nip.io",
    });

    expect(firstA).toMatchObject({
      identity: { realmName: "qcrm-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa" },
      reconciled: false,
    });
    expect(firstB).toMatchObject({
      identity: { realmName: "qcrm-bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb" },
      reconciled: false,
    });
    expect(retryA.reconciled).toBe(true);
    expect(JSON.stringify([firstA, firstB, retryA])).not.toContain(
      keycloakProvisionerClientSecret!,
    );

    const clientSecretA = await readFile(
      join(secretDirectory, tenantA, "oidc-client-secret"),
      "utf8",
    );
    const clientSecretB = await readFile(
      join(secretDirectory, tenantB, "oidc-client-secret"),
      "utf8",
    );
    expect(clientSecretA.trim()).not.toBe(clientSecretB.trim());
    expect((await stat(join(secretDirectory, tenantA, "oidc-client-secret"))).mode & 0o777).toBe(
      0o400,
    );
    const redisA = new URL(await tenantRedisUrl(tenantA));
    const redisB = new URL(await tenantRedisUrl(tenantB));
    expect(redisA.username).not.toBe(redisB.username);
    expect(redisA.password).not.toBe(redisB.password);
    expect(redisA.pathname).toBe("/0");
    expect(redisB.pathname).toBe("/0");
  }, 30_000);

  it("reports a persisted secret divergence as a typed conflict", async () => {
    await expect(
      provisioner().provision({
        tenantProfileId: tenantA,
        serverId,
        hostname: "tenant-a-different.127-0-0-1.nip.io",
      }),
    ).rejects.toMatchObject({
      name: TenantIdentityProvisioningError.name,
      reason: "TARGET_CONFLICT",
    });
  });

  it("converges after concurrent workers contend for one tenant identity", async () => {
    const command = {
      tenantProfileId: tenantC,
      serverId,
      hostname: "tenant-c.127-0-0-1.nip.io",
    };
    const results = await Promise.allSettled([
      provisioner().provision(command),
      provisioner().provision(command),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({
          name: TenantIdentityProvisioningError.name,
          reason: "TARGET_CONFLICT",
        });
      }
    }
    await expect(provisioner().provision(command)).resolves.toMatchObject({ reconciled: true });
  }, 30_000);
});
