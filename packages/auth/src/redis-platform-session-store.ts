import { createClient, type RedisClientType } from "redis";
import { z } from "zod";

import type { WebAuthConfig } from "@quantum-crm/config";
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
  accessTokenExpiresAt: z.string().datetime(),
  refreshToken: z.string().min(1).max(16_384).optional(),
  idToken: z.string().min(1).max(16_384),
  csrfToken: z.string().length(43),
  authenticatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  absoluteExpiresAt: z.string().datetime(),
});

export type PlatformSessionRedisClient = Pick<
  RedisClientType,
  "del" | "eval" | "get" | "getDel" | "set"
>;

const updateWithLeaseScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local result = redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3], 'XX')
if result then return 1 else return 0 end
`;
const releaseLeaseScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
const invalidateWithLeaseScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[2])
`;

function secondsUntil(date: Date, now: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 1_000));
}

export class RedisPlatformSessionStore implements PlatformSessionStore {
  public constructor(
    private readonly redis: PlatformSessionRedisClient,
    private readonly sessionNamespace: string = "platform",
  ) {}

  public async createLoginTransaction(transaction: PlatformLoginTransaction): Promise<SecretValue> {
    const handle = newOpaqueHandle();
    const ttl = secondsUntil(transaction.expiresAt, new Date());
    if (ttl < 1) throw new PlatformSessionError();
    const result = await this.redis.set(
      sessionKey(this.sessionNamespace, "login", handle),
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
      const raw = await this.redis.getDel(sessionKey(this.sessionNamespace, "login", handle));
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
    const key = sessionKey(this.sessionNamespace, "session", handle);
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
        accessTokenExpiresAt: new Date(value.accessTokenExpiresAt),
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

  public async acquireSessionRefresh(
    handle: SecretValue,
    ttlSeconds: number,
  ): Promise<SecretValue | null> {
    try {
      const lease = newOpaqueHandle();
      const result = await this.redis.set(
        sessionKey(this.sessionNamespace, "refresh", handle),
        lease.expose(),
        {
          EX: ttlSeconds,
          NX: true,
        },
      );
      return result === "OK" ? lease : null;
    } catch {
      throw new PlatformSessionError();
    }
  }

  public async updateSession(
    handle: SecretValue,
    lease: SecretValue,
    session: PlatformWebSession,
    idleTtlSeconds: number,
  ): Promise<void> {
    const ttl = this.sessionTtl(session, idleTtlSeconds);
    try {
      const result = await this.redis.eval(updateWithLeaseScript, {
        keys: [
          sessionKey(this.sessionNamespace, "refresh", handle),
          sessionKey(this.sessionNamespace, "session", handle),
        ],
        arguments: [lease.expose(), this.serializeSession(session), String(ttl)],
      });
      if (result !== 1) throw new PlatformSessionError();
    } catch {
      throw new PlatformSessionError();
    }
  }

  public async releaseSessionRefresh(handle: SecretValue, lease: SecretValue): Promise<void> {
    try {
      await this.redis.eval(releaseLeaseScript, {
        keys: [sessionKey(this.sessionNamespace, "refresh", handle)],
        arguments: [lease.expose()],
      });
    } catch {
      throw new PlatformSessionError();
    }
  }

  public async invalidateSessionRefresh(handle: SecretValue, lease: SecretValue): Promise<void> {
    try {
      await this.redis.eval(invalidateWithLeaseScript, {
        keys: [
          sessionKey(this.sessionNamespace, "refresh", handle),
          sessionKey(this.sessionNamespace, "session", handle),
        ],
        arguments: [lease.expose()],
      });
    } catch {
      throw new PlatformSessionError();
    }
  }

  public async deleteSession(handle: SecretValue): Promise<void> {
    try {
      await this.redis.del(sessionKey(this.sessionNamespace, "session", handle));
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
    const ttl = this.sessionTtl(session, idleTtlSeconds);
    const result = await this.redis.set(
      sessionKey(this.sessionNamespace, "session", handle),
      this.serializeSession(session),
      { EX: ttl, ...(create ? { NX: true as const } : { XX: true as const }) },
    );
    if (result !== "OK") throw new PlatformSessionError();
  }

  private sessionTtl(session: PlatformWebSession, idleTtlSeconds: number): number {
    const ttl = Math.min(
      idleTtlSeconds,
      secondsUntil(session.absoluteExpiresAt, session.lastSeenAt),
    );
    if (ttl < 1) throw new PlatformSessionError();
    return ttl;
  }

  private serializeSession(session: PlatformWebSession): string {
    return JSON.stringify({
      subject: session.subject,
      accessToken: session.accessToken.expose(),
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      ...(session.refreshToken ? { refreshToken: session.refreshToken.expose() } : {}),
      idToken: session.idToken.expose(),
      csrfToken: session.csrfToken,
      authenticatedAt: session.authenticatedAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    });
  }
}

export async function createRedisPlatformSessionStore(
  config: WebAuthConfig,
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
    store: new RedisPlatformSessionStore(client, config.sessionNamespace),
    close: async () => client.destroy(),
  });
}
