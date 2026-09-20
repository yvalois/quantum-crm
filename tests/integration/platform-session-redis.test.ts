import { readFileSync } from "node:fs";

import type { AdminWebAuthConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";
import {
  createRedisPlatformSessionStore,
  newCsrfToken,
  type RedisPlatformSessionStore,
} from "@quantum-crm/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let store: RedisPlatformSessionStore;
let close: (() => Promise<void>) | undefined;

function testConfig(): AdminWebAuthConfig {
  const secretPath = process.env.QCRM_TEST_SESSION_REDIS_URL_FILE;
  if (!secretPath) throw new Error("QCRM_TEST_SESSION_REDIS_URL_FILE is required");
  const redisUrl = readFileSync(secretPath, "utf8").trim();
  return {
    schemaVersion: "admin-web-auth-config/v1",
    environment: "test",
    origin: "http://admin-web.example.test",
    issuer: "http://keycloak:8080/realms/quantum-platform",
    clientId: "quantum-admin-web",
    clientSecret: new SecretValue("synthetic-client-secret"),
    redisUrl: new SecretValue(redisUrl),
    callbackUrl: "http://admin-web.example.test/api/auth/callback/keycloak",
    signedOutUrl: "http://admin-web.example.test/signed-out",
    requiredAcr: "2",
    loginTransactionTtlSeconds: 300,
    sessionIdleTtlSeconds: 30,
    sessionAbsoluteTtlSeconds: 300,
    secureCookies: false,
  };
}

beforeAll(async () => {
  const connected = await createRedisPlatformSessionStore(testConfig());
  store = connected.store;
  close = connected.close;
});

afterAll(async () => {
  await close?.();
});

describe("Redis platform session store", () => {
  it("atomically consumes each OIDC transaction only once", async () => {
    const now = new Date();
    const handle = await store.createLoginTransaction({
      state: "s".repeat(43),
      nonce: "n".repeat(43),
      codeVerifier: new SecretValue("v".repeat(43)),
      returnTo: "/tenants",
      expiresAt: new Date(now.getTime() + 30_000),
    });

    const results = await Promise.all([
      store.takeLoginTransaction(handle, now),
      store.takeLoginTransaction(handle, now),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.find(Boolean)?.returnTo).toBe("/tenants");
  });

  it("creates, touches and invalidates an opaque session", async () => {
    const now = new Date();
    const handle = await store.createSession(
      {
        subject: "platform-operator",
        accessToken: new SecretValue("synthetic-access-token"),
        refreshToken: new SecretValue("synthetic-refresh-token"),
        idToken: new SecretValue("synthetic-id-token"),
        csrfToken: newCsrfToken(),
        authenticatedAt: now,
        createdAt: now,
        lastSeenAt: now,
        absoluteExpiresAt: new Date(now.getTime() + 300_000),
      },
      30,
    );
    const touchedAt = new Date(now.getTime() + 1_000);

    const session = await store.readSession(handle, touchedAt, 30);

    expect(session?.subject).toBe("platform-operator");
    expect(session?.lastSeenAt).toEqual(touchedAt);
    expect(session?.accessToken.expose()).toBe("synthetic-access-token");
    await store.deleteSession(handle);
    await expect(store.readSession(handle, new Date(), 30)).resolves.toBeNull();
  });
});
