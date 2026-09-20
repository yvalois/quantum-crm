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
    adminApiOrigin: "http://admin-api:3002",
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
        accessTokenExpiresAt: new Date(now.getTime() + 60_000),
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

  it("updates a session only while the caller owns its refresh lease", async () => {
    const now = new Date();
    const original = {
      subject: "platform-operator",
      accessToken: new SecretValue("original-access-token"),
      accessTokenExpiresAt: new Date(now.getTime() + 10_000),
      refreshToken: new SecretValue("original-refresh-token"),
      idToken: new SecretValue("synthetic-id-token"),
      csrfToken: newCsrfToken(),
      authenticatedAt: now,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 300_000),
    };
    const handle = await store.createSession(original, 30);
    const lease = await store.acquireSessionRefresh(handle, 10);
    expect(lease).not.toBeNull();
    await expect(store.acquireSessionRefresh(handle, 10)).resolves.toBeNull();

    await expect(
      store.updateSession(
        handle,
        new SecretValue("x".repeat(43)),
        { ...original, accessToken: new SecretValue("forged-access-token") },
        30,
      ),
    ).rejects.toThrow();
    await store.updateSession(
      handle,
      lease!,
      { ...original, accessToken: new SecretValue("rotated-access-token") },
      30,
    );
    await store.releaseSessionRefresh(handle, new SecretValue("x".repeat(43)));
    await expect(store.acquireSessionRefresh(handle, 10)).resolves.toBeNull();
    await store.releaseSessionRefresh(handle, lease!);
    const invalidationLease = await store.acquireSessionRefresh(handle, 10);
    expect(invalidationLease).not.toBeNull();
    expect((await store.readSession(handle, now, 30))?.accessToken.expose()).toBe(
      "rotated-access-token",
    );
    await store.invalidateSessionRefresh(handle, new SecretValue("x".repeat(43)));
    await expect(store.readSession(handle, now, 30)).resolves.not.toBeNull();
    await store.invalidateSessionRefresh(handle, invalidationLease!);
    await expect(store.readSession(handle, now, 30)).resolves.toBeNull();
    await store.releaseSessionRefresh(handle, invalidationLease!);
    await store.deleteSession(handle);
  });
});
