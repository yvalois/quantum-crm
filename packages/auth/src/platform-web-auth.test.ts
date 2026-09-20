import type { AdminWebAuthConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it } from "vitest";

import {
  KeycloakPlatformOidcProvider,
  PlatformWebAuthenticationError,
  PlatformWebAuthService,
  type PlatformOidcProvider,
  type PlatformOidcRefreshTokenSet,
  type PlatformOidcTokenSet,
} from "./platform-web-auth.js";
import { newCsrfToken } from "./platform-web-session.js";
import type {
  PlatformLoginTransaction,
  PlatformSessionStore,
  PlatformWebSession,
} from "./platform-web-session.js";

const now = new Date("2026-09-20T15:00:00.000Z");
const config: AdminWebAuthConfig = {
  schemaVersion: "admin-web-auth-config/v1",
  environment: "test",
  origin: "http://admin.example.test",
  adminApiOrigin: "http://admin-api:3002",
  issuer: "http://identity.example.test/realms/quantum-platform",
  clientId: "quantum-admin-web",
  clientSecret: new SecretValue("synthetic-client-secret"),
  redisUrl: new SecretValue("redis://session-user:synthetic@redis:6379/1"),
  callbackUrl: "http://admin.example.test/api/auth/callback/keycloak",
  signedOutUrl: "http://admin.example.test/signed-out",
  requiredAcr: "2",
  loginTransactionTtlSeconds: 300,
  sessionIdleTtlSeconds: 1800,
  sessionAbsoluteTtlSeconds: 28800,
  secureCookies: false,
};

class MemoryStore implements PlatformSessionStore {
  public transaction: PlatformLoginTransaction | null = null;
  public sessionValue: PlatformWebSession | null = null;
  public deleted = false;
  public leaseAvailable = true;

  public async createLoginTransaction(transaction: PlatformLoginTransaction): Promise<SecretValue> {
    this.transaction = transaction;
    return new SecretValue("a".repeat(43));
  }

  public async takeLoginTransaction(): Promise<PlatformLoginTransaction | null> {
    const transaction = this.transaction;
    this.transaction = null;
    return transaction;
  }

  public async createSession(session: PlatformWebSession): Promise<SecretValue> {
    this.sessionValue = session;
    return new SecretValue("b".repeat(43));
  }

  public async readSession(): Promise<PlatformWebSession | null> {
    return this.sessionValue;
  }

  public async acquireSessionRefresh(): Promise<SecretValue | null> {
    return this.leaseAvailable ? new SecretValue("l".repeat(43)) : null;
  }

  public async updateSession(
    _handle: SecretValue,
    _lease: SecretValue,
    session: PlatformWebSession,
  ): Promise<void> {
    this.sessionValue = session;
  }

  public async releaseSessionRefresh(): Promise<void> {}

  public async invalidateSessionRefresh(): Promise<void> {
    this.deleted = true;
    this.sessionValue = null;
  }

  public async deleteSession(): Promise<void> {
    this.deleted = true;
    this.sessionValue = null;
  }
}

function tokenSet(override: Partial<PlatformOidcTokenSet> = {}): PlatformOidcTokenSet {
  return {
    subject: "platform-operator-subject",
    acr: "2",
    authenticatedAt: new Date(now.getTime() - 10_000),
    accessToken: new SecretValue("synthetic-access-token"),
    accessTokenExpiresAt: new Date(now.getTime() + 300_000),
    refreshToken: new SecretValue("synthetic-refresh-token"),
    idToken: new SecretValue("synthetic-id-token"),
    ...override,
  };
}

class FakeProvider implements PlatformOidcProvider {
  public exchanged = false;
  public revoked = false;
  public tokens = tokenSet();
  public refreshed = false;
  public refreshFails = false;

  public authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
  }): URL {
    const url = new URL("http://identity.example.test/authorize");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    return url;
  }

  public async exchange(): Promise<PlatformOidcTokenSet> {
    this.exchanged = true;
    return this.tokens;
  }

  public async refresh(): Promise<PlatformOidcRefreshTokenSet> {
    this.refreshed = true;
    if (this.refreshFails) throw new PlatformWebAuthenticationError();
    return {
      accessToken: new SecretValue("rotated-access-token"),
      accessTokenExpiresAt: new Date(now.getTime() + 300_000),
      refreshToken: new SecretValue("rotated-refresh-token"),
    };
  }

  public async revokeRefreshToken(): Promise<void> {
    this.revoked = true;
  }
}

describe("platform web authentication service", () => {
  it("builds a fixed Authorization Code request with PKCE, nonce and MFA assurance", () => {
    const provider = new KeycloakPlatformOidcProvider(config);
    const url = provider.authorizationUrl({
      state: "s".repeat(43),
      nonce: "n".repeat(43),
      codeChallenge: "c".repeat(43),
    });

    expect(url.origin + url.pathname).toBe(`${config.issuer}/protocol/openid-connect/auth`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(config.callbackUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("s".repeat(43));
    expect(url.searchParams.get("nonce")).toBe("n".repeat(43));
    expect(url.searchParams.get("acr_values")).toBe("2");
    expect(url.toString()).not.toContain(config.clientSecret.expose());
  });

  it("creates a one-use PKCE transaction and normalizes the return target", async () => {
    const store = new MemoryStore();
    const service = new PlatformWebAuthService(config, store, new FakeProvider(), () => now);

    const result = await service.beginLogin("https://attacker.test");

    expect(result.transactionHandle.expose()).toBe("a".repeat(43));
    expect(result.authorizationUrl.searchParams.get("state")).toHaveLength(43);
    expect(result.authorizationUrl.searchParams.get("nonce")).toHaveLength(43);
    expect(result.authorizationUrl.searchParams.get("code_challenge")).toHaveLength(43);
    expect(store.transaction?.returnTo).toBe("/");
    expect(store.transaction?.codeVerifier.expose()).toHaveLength(43);
  });

  it("exchanges a transaction once and stores tokens only in the server session", async () => {
    const store = new MemoryStore();
    const provider = new FakeProvider();
    const service = new PlatformWebAuthService(config, store, provider, () => now);
    const started = await service.beginLogin("/tenants");

    const result = await service.completeLogin(
      new URL(`${config.callbackUrl}?code=synthetic&state=received`),
      started.transactionHandle,
    );

    expect(result).toEqual({ returnTo: "/tenants", sessionHandle: expect.any(SecretValue) });
    expect(JSON.stringify(result)).not.toContain("synthetic-access-token");
    expect(store.sessionValue?.accessToken.expose()).toBe("synthetic-access-token");
    expect(store.sessionValue?.csrfToken).toHaveLength(43);
    expect(store.sessionValue?.absoluteExpiresAt.toISOString()).toBe("2026-09-20T23:00:00.000Z");
    await expect(
      service.completeLogin(new URL(config.callbackUrl), started.transactionHandle),
    ).rejects.toBeInstanceOf(PlatformWebAuthenticationError);
  });

  it.each([
    ["wrong assurance", tokenSet({ acr: "1" })],
    ["stale authentication", tokenSet({ authenticatedAt: new Date(now.getTime() - 301_000) })],
    ["future authentication", tokenSet({ authenticatedAt: new Date(now.getTime() + 1) })],
  ])("rejects %s without creating a session", async (_case, tokens) => {
    const store = new MemoryStore();
    const provider = new FakeProvider();
    provider.tokens = tokens;
    const service = new PlatformWebAuthService(config, store, provider, () => now);
    const started = await service.beginLogin("/");

    await expect(
      service.completeLogin(new URL(config.callbackUrl), started.transactionHandle),
    ).rejects.toBeInstanceOf(PlatformWebAuthenticationError);
    expect(store.sessionValue).toBeNull();
  });

  it("deletes the server session and best-effort revokes the refresh token", async () => {
    const store = new MemoryStore();
    const provider = new FakeProvider();
    const service = new PlatformWebAuthService(config, store, provider, () => now);
    const started = await service.beginLogin("/");
    const completed = await service.completeLogin(
      new URL(config.callbackUrl),
      started.transactionHandle,
    );

    await service.logout(completed.sessionHandle);

    expect(store.deleted).toBe(true);
    expect(provider.revoked).toBe(true);
  });

  it("reuses a sufficiently valid access token without refreshing it", async () => {
    const store = new MemoryStore();
    const provider = new FakeProvider();
    store.sessionValue = {
      ...tokenSet(),
      csrfToken: newCsrfToken(),
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 600_000),
    };
    const service = new PlatformWebAuthService(config, store, provider, () => now);

    const session = await service.session(new SecretValue("h".repeat(43)));

    expect(session?.accessToken.expose()).toBe("synthetic-access-token");
    expect(provider.refreshed).toBe(false);
  });

  it("rotates a near-expiry access and refresh token inside the server session", async () => {
    const store = new MemoryStore();
    const provider = new FakeProvider();
    store.sessionValue = {
      ...tokenSet({ accessTokenExpiresAt: new Date(now.getTime() + 10_000) }),
      csrfToken: newCsrfToken(),
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 600_000),
    };
    const service = new PlatformWebAuthService(config, store, provider, () => now);

    const session = await service.session(new SecretValue("h".repeat(43)));

    expect(provider.refreshed).toBe(true);
    expect(session?.accessToken.expose()).toBe("rotated-access-token");
    expect(session?.refreshToken?.expose()).toBe("rotated-refresh-token");
    expect(session?.absoluteExpiresAt).toEqual(new Date(now.getTime() + 600_000));
  });

  it("fails closed if refresh cannot complete or another replica owns the lease", async () => {
    const createNearExpiryStore = (): MemoryStore => {
      const store = new MemoryStore();
      store.sessionValue = {
        ...tokenSet({ accessTokenExpiresAt: new Date(now.getTime() + 10_000) }),
        csrfToken: newCsrfToken(),
        createdAt: now,
        lastSeenAt: now,
        absoluteExpiresAt: new Date(now.getTime() + 600_000),
      };
      return store;
    };
    const busyStore = createNearExpiryStore();
    busyStore.leaseAvailable = false;
    await expect(
      new PlatformWebAuthService(config, busyStore, new FakeProvider(), () => now).session(
        new SecretValue("h".repeat(43)),
      ),
    ).rejects.toBeInstanceOf(PlatformWebAuthenticationError);
    expect(busyStore.deleted).toBe(false);

    const failedStore = createNearExpiryStore();
    const failedProvider = new FakeProvider();
    failedProvider.refreshFails = true;
    await expect(
      new PlatformWebAuthService(config, failedStore, failedProvider, () => now).session(
        new SecretValue("h".repeat(43)),
      ),
    ).rejects.toBeInstanceOf(PlatformWebAuthenticationError);
    expect(failedStore.deleted).toBe(true);
  });
});
