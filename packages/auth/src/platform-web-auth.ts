import type { AdminWebAuthConfig, SecretValue } from "@quantum-crm/config";
import { SecretValue as ProtectedValue } from "@quantum-crm/config";
import {
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  Configuration,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  tokenRevocation,
} from "openid-client";

import {
  newCsrfToken,
  PlatformSessionError,
  safeReturnTo,
  type PlatformSessionStore,
  type PlatformWebSession,
} from "./platform-web-session.js";

export interface PlatformOidcTokenSet {
  readonly subject: string;
  readonly acr: string;
  readonly authenticatedAt: Date;
  readonly accessToken: SecretValue;
  readonly refreshToken?: SecretValue;
  readonly idToken: SecretValue;
}

export interface PlatformOidcProvider {
  authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
  }): URL;
  exchange(input: {
    readonly callbackUrl: URL;
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: SecretValue;
  }): Promise<PlatformOidcTokenSet>;
  revokeRefreshToken(token: SecretValue): Promise<void>;
}

export interface PlatformLoginStart {
  readonly authorizationUrl: URL;
  readonly transactionHandle: SecretValue;
}

export interface PlatformLoginCompletion {
  readonly returnTo: string;
  readonly sessionHandle: SecretValue;
}

export class PlatformWebAuthenticationError extends Error {
  public constructor() {
    super("Platform web authentication failed");
    this.name = "PlatformWebAuthenticationError";
  }
}

export class KeycloakPlatformOidcProvider implements PlatformOidcProvider {
  readonly #configuration: Configuration;

  public constructor(private readonly config: AdminWebAuthConfig) {
    const issuer = config.issuer;
    this.#configuration = new Configuration(
      {
        issuer,
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
        jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        revocation_endpoint: `${issuer}/protocol/openid-connect/revoke`,
        code_challenge_methods_supported: ["S256"],
        id_token_signing_alg_values_supported: ["RS256"],
      },
      config.clientId,
      {
        redirect_uris: [config.callbackUrl],
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "client_secret_basic",
        id_token_signed_response_alg: "RS256",
      },
      ClientSecretBasic(config.clientSecret.expose()),
    );
    if (
      (config.environment === "local" || config.environment === "test") &&
      config.issuer.startsWith("http://")
    ) {
      allowInsecureRequests(this.#configuration);
    }
    this.#configuration.timeout = 5;
  }

  public authorizationUrl(input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
  }): URL {
    return buildAuthorizationUrl(this.#configuration, {
      response_type: "code",
      redirect_uri: this.config.callbackUrl,
      scope: "openid",
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      acr_values: this.config.requiredAcr,
      max_age: String(this.config.loginTransactionTtlSeconds),
      claims: JSON.stringify({
        id_token: {
          acr: { essential: true, values: [this.config.requiredAcr] },
          auth_time: { essential: true },
        },
      }),
    });
  }

  public async exchange(input: {
    readonly callbackUrl: URL;
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: SecretValue;
  }): Promise<PlatformOidcTokenSet> {
    try {
      const tokens = await authorizationCodeGrant(this.#configuration, input.callbackUrl, {
        expectedState: input.state,
        expectedNonce: input.nonce,
        pkceCodeVerifier: input.codeVerifier.expose(),
        idTokenExpected: true,
        maxAge: this.config.loginTransactionTtlSeconds,
      });
      const claims = tokens.claims();
      if (
        !claims ||
        typeof claims.sub !== "string" ||
        claims.acr !== this.config.requiredAcr ||
        typeof claims.auth_time !== "number" ||
        !Number.isInteger(claims.auth_time) ||
        typeof tokens.access_token !== "string" ||
        typeof tokens.id_token !== "string"
      ) {
        throw new PlatformWebAuthenticationError();
      }
      return Object.freeze({
        subject: claims.sub,
        acr: claims.acr,
        authenticatedAt: new Date(claims.auth_time * 1_000),
        accessToken: new ProtectedValue(tokens.access_token),
        ...(tokens.refresh_token ? { refreshToken: new ProtectedValue(tokens.refresh_token) } : {}),
        idToken: new ProtectedValue(tokens.id_token),
      });
    } catch {
      throw new PlatformWebAuthenticationError();
    }
  }

  public async revokeRefreshToken(token: SecretValue): Promise<void> {
    await tokenRevocation(this.#configuration, token.expose(), {
      token_type_hint: "refresh_token",
    });
  }
}

export class PlatformWebAuthService {
  public constructor(
    private readonly config: AdminWebAuthConfig,
    private readonly store: PlatformSessionStore,
    private readonly provider: PlatformOidcProvider,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async beginLogin(returnTo?: string | null): Promise<PlatformLoginStart> {
    try {
      const now = this.clock();
      const state = randomState();
      const nonce = randomNonce();
      const codeVerifier = randomPKCECodeVerifier();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
      const transactionHandle = await this.store.createLoginTransaction({
        state,
        nonce,
        codeVerifier: new ProtectedValue(codeVerifier),
        returnTo: safeReturnTo(returnTo),
        expiresAt: new Date(now.getTime() + this.config.loginTransactionTtlSeconds * 1_000),
      });
      return Object.freeze({
        authorizationUrl: this.provider.authorizationUrl({ state, nonce, codeChallenge }),
        transactionHandle,
      });
    } catch {
      throw new PlatformWebAuthenticationError();
    }
  }

  public async completeLogin(
    callbackUrl: URL,
    transactionHandle: SecretValue,
  ): Promise<PlatformLoginCompletion> {
    try {
      const now = this.clock();
      const transaction = await this.store.takeLoginTransaction(transactionHandle, now);
      if (!transaction) throw new PlatformWebAuthenticationError();
      const tokens = await this.provider.exchange({
        callbackUrl,
        state: transaction.state,
        nonce: transaction.nonce,
        codeVerifier: transaction.codeVerifier,
      });
      if (
        tokens.acr !== this.config.requiredAcr ||
        tokens.authenticatedAt > now ||
        now.getTime() - tokens.authenticatedAt.getTime() >
          this.config.loginTransactionTtlSeconds * 1_000
      ) {
        throw new PlatformWebAuthenticationError();
      }
      const sessionHandle = await this.store.createSession(
        Object.freeze({
          subject: tokens.subject,
          accessToken: tokens.accessToken,
          ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
          idToken: tokens.idToken,
          csrfToken: newCsrfToken(),
          authenticatedAt: tokens.authenticatedAt,
          createdAt: now,
          lastSeenAt: now,
          absoluteExpiresAt: new Date(
            now.getTime() + this.config.sessionAbsoluteTtlSeconds * 1_000,
          ),
        }),
        this.config.sessionIdleTtlSeconds,
      );
      return Object.freeze({ returnTo: transaction.returnTo, sessionHandle });
    } catch {
      throw new PlatformWebAuthenticationError();
    }
  }

  public async session(handle: SecretValue): Promise<PlatformWebSession | null> {
    try {
      return await this.store.readSession(handle, this.clock(), this.config.sessionIdleTtlSeconds);
    } catch (error) {
      if (error instanceof PlatformSessionError) throw new PlatformWebAuthenticationError();
      throw error;
    }
  }

  public async logout(handle: SecretValue): Promise<void> {
    const session = await this.session(handle);
    await this.store.deleteSession(handle).catch(() => undefined);
    if (session?.refreshToken) {
      await this.provider.revokeRefreshToken(session.refreshToken).catch(() => undefined);
    }
  }
}
