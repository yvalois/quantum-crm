import { createClient, type RedisClientType } from "redis";
import { z } from "zod";

import type { AdminWebAuthConfig } from "@quantum-crm/config";
import { SecretValue } from "@quantum-crm/config";

import {
  newOpaqueHandle,
  PlatformSessionError,
  sessionKey,
  type PlatformLoginTransaction,
  type PlatformSessionStore,
  type PlatformWebSession,
} from "./platform-web-session.js";

const loginSchema = z.object({
  state: z.string().min(32).max(256),
  nonce: z.string().min(32).max(256),
  codeVerifier: z.string().min(43).max(128),
  returnTo: z.string().min(1).max(512),
  expiresAt: z.string().datetime(),
});
const sessionSchema = z.object({
  subject: z.string().min(1).max(255),
  accessToken: z.string().min(1).max(16_384),
  refreshToken: z.string().min(1).max(16_384).optional(),
  idToken: z.string().min(1).max(16_384),
  csrfToken: z.string().length(43),
  authenticatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  absoluteExpiresAt: z.string().datetime(),
});

export type PlatformSessionRedisClient = Pick<RedisClientType, "del" | "get" | "getDel" | "set">;

function secondsUntil(date: Date, now: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 1_000));
}

export class RedisPlatformSessionStore implements PlatformSessionStore {
  public constructor(private readonly redis: PlatformSessionRedisClient) {}

  public async createLoginTransaction(transaction: PlatformLoginTransaction): Promise<SecretValue> {
    const handle = newOpaqueHandle();
    const ttl = secondsUntil(transaction.expiresAt, new Date());
    if (ttl < 1) throw new PlatformSessionError();
    const result = await this.redis.set(
      sessionKey("login", handle),
      JSON.stringify({
        ...transaction,
        codeVerifier: transaction.codeVerifier.expose(),
        expiresAt: transaction.expiresAt.toISOString(),
      }),
      { EX: ttl, NX: true },
    );
    if (result !== "OK") throw new PlatformSessionError();
    return handle;
  }

  public async takeLoginTransaction(
    handle: SecretValue,
    now: Date,
  ): Promise<PlatformLoginTransaction | null> {
    try {
      const raw = await this.redis.getDel(sessionKey("login", handle));
      if (!raw) return null;
      const value = loginSchema.parse(JSON.parse(raw));
      const expiresAt = new Date(value.expiresAt);
      if (expiresAt <= now) return null;
      return Object.freeze({
        state: value.state,
        nonce: value.nonce,
        codeVerifier: new SecretValue(value.codeVerifier),
        returnTo: value.returnTo,
        expiresAt,
      });
    } catch {
      throw new PlatformSessionError();
    }
  }

  public async createSession(
    session: PlatformWebSession,
    idleTtlSeconds: number,
  ): Promise<SecretValue> {
    const handle = newOpaqueHandle();
    await this.writeSession(handle, session, idleTtlSeconds, true);
    return handle;
  }

  public async readSession(
    handle: SecretValue,
    now: Date,
    idleTtlSeconds: number,
  ): Promise<PlatformWebSession | null> {
    const key = sessionKey("session", handle);
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const value = sessionSchema.parse(JSON.parse(raw));
      const absoluteExpiresAt = new Date(value.absoluteExpiresAt);
      if (absoluteExpiresAt <= now) {
        await this.redis.del(key);
        return null;
      }
      const session = Object.freeze({
        subject: value.subject,
        accessToken: new SecretValue(value.accessToken),
        ...(value.refreshToken ? { refreshToken: new SecretValue(value.refreshToken) } : {}),
        idToken: new SecretValue(value.idToken),
        csrfToken: value.csrfToken,
        authenticatedAt: new Date(value.authenticatedAt),
        createdAt: new Date(value.createdAt),
        lastSeenAt: now,
        absoluteExpiresAt,
      });
      await this.writeSession(handle, session, idleTtlSeconds, false);
      return session;
    } catch {
      await this.redis.del(key).catch(() => undefined);
      throw new PlatformSessionError();
    }
  }

  public async deleteSession(handle: SecretValue): Promise<void> {
    try {
      await this.redis.del(sessionKey("session", handle));
    } catch {
      throw new PlatformSessionError();
    }
  }

  private async writeSession(
    handle: SecretValue,
    session: PlatformWebSession,
    idleTtlSeconds: number,
    create: boolean,
  ): Promise<void> {
    const ttl = Math.min(
      idleTtlSeconds,
      secondsUntil(session.absoluteExpiresAt, session.lastSeenAt),
    );
    if (ttl < 1) throw new PlatformSessionError();
    const result = await this.redis.set(
      sessionKey("session", handle),
      JSON.stringify({
        subject: session.subject,
        accessToken: session.accessToken.expose(),
        ...(session.refreshToken ? { refreshToken: session.refreshToken.expose() } : {}),
        idToken: session.idToken.expose(),
        csrfToken: session.csrfToken,
        authenticatedAt: session.authenticatedAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      }),
      { EX: ttl, ...(create ? { NX: true as const } : { XX: true as const }) },
    );
    if (result !== "OK") throw new PlatformSessionError();
  }
}

export async function createRedisPlatformSessionStore(
  config: AdminWebAuthConfig,
): Promise<{ readonly store: RedisPlatformSessionStore; readonly close: () => Promise<void> }> {
  const client = createClient({
    url: config.redisUrl.expose(),
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => (retries >= 3 ? false : Math.min(100 * 2 ** retries, 1_000)),
    },
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch {
    client.destroy();
    throw new PlatformSessionError();
  }
  return Object.freeze({
    store: new RedisPlatformSessionStore(client),
    close: async () => client.destroy(),
  });
}
