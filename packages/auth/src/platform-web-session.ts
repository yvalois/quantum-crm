import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { SecretValue } from "@quantum-crm/config";

const handlePattern = /^[A-Za-z0-9_-]{43}$/u;
const csrfPattern = /^[A-Za-z0-9_-]{43}$/u;

export interface PlatformLoginTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: SecretValue;
  readonly returnTo: string;
  readonly expiresAt: Date;
}

export interface PlatformWebSession {
  readonly subject: string;
  readonly accessToken: SecretValue;
  readonly accessTokenExpiresAt: Date;
  readonly refreshToken?: SecretValue;
  readonly idToken: SecretValue;
  readonly csrfToken: string;
  readonly authenticatedAt: Date;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface PlatformSessionStore {
  createLoginTransaction(transaction: PlatformLoginTransaction): Promise<SecretValue>;
  takeLoginTransaction(handle: SecretValue, now: Date): Promise<PlatformLoginTransaction | null>;
  createSession(session: PlatformWebSession, idleTtlSeconds: number): Promise<SecretValue>;
  readSession(
    handle: SecretValue,
    now: Date,
    idleTtlSeconds: number,
  ): Promise<PlatformWebSession | null>;
  acquireSessionRefresh(handle: SecretValue, ttlSeconds: number): Promise<SecretValue | null>;
  updateSession(
    handle: SecretValue,
    lease: SecretValue,
    session: PlatformWebSession,
    idleTtlSeconds: number,
  ): Promise<void>;
  invalidateSessionRefresh(handle: SecretValue, lease: SecretValue): Promise<void>;
  releaseSessionRefresh(handle: SecretValue, lease: SecretValue): Promise<void>;
  deleteSession(handle: SecretValue): Promise<void>;
}

export function newOpaqueHandle(): SecretValue {
  return new SecretValue(randomBytes(32).toString("base64url"));
}

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sessionKey(
  sessionNamespace: string,
  namespace: "login" | "session" | "refresh",
  handle: SecretValue,
): string {
  const exposed = handle.expose();
  if (!handlePattern.test(exposed) || !/^[a-z][a-z0-9:-]{0,127}$/u.test(sessionNamespace)) {
    throw new PlatformSessionError();
  }
  const digest = createHash("sha256").update(exposed).digest("base64url");
  return `qcrm:${sessionNamespace}:${namespace}:v1:${digest}`;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (
    !value ||
    value.length > 512 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    return "/";
  }
  return value;
}

export function validateCsrf(expected: string, received: string | null): boolean {
  if (!csrfPattern.test(expected) || !received || !csrfPattern.test(received)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function validateRequestOrigin(
  expectedOrigin: string,
  receivedOrigin: string | null,
): boolean {
  if (!receivedOrigin) {
    return false;
  }
  try {
    return new URL(receivedOrigin).origin === expectedOrigin && receivedOrigin === expectedOrigin;
  } catch {
    return false;
  }
}

export class PlatformSessionError extends Error {
  public constructor() {
    super("Platform session operation failed");
    this.name = "PlatformSessionError";
  }
}
