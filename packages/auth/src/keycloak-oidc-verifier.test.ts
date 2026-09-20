import { parseOidcConfig, SecretValue } from "@quantum-crm/config";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createKeycloakOidcAccessTokenVerifier,
  OidcAccessTokenVerificationError,
} from "./keycloak-oidc-verifier.js";

const now = new Date("2026-09-20T12:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);
const config = parseOidcConfig(
  "admin-api",
  { provider: "keycloak", boundary: "platform" },
  "test",
  {
    QCRM_OIDC_ISSUER: "https://identity.example.test/realms/quantum-platform",
    QCRM_OIDC_AUDIENCE: "quantum-admin-api",
    QCRM_OIDC_REQUIRED_ACR: "2",
    QCRM_OIDC_MAX_TOKEN_AGE_SECONDS: "300",
  },
);

let privateKey: CryptoKey;
let attackerPrivateKey: CryptoKey;
let trustedJwk: JWK;

beforeAll(async () => {
  const trusted = await generateKeyPair("RS256");
  const attacker = await generateKeyPair("RS256");
  privateKey = trusted.privateKey;
  attackerPrivateKey = attacker.privateKey;
  trustedJwk = { ...(await exportJWK(trusted.publicKey)), kid: "trusted-key", alg: "RS256" };
});

function verifier() {
  return createKeycloakOidcAccessTokenVerifier(config, {
    keyResolver: createLocalJWKSet({ keys: [trustedJwk] }),
    currentDate: () => now,
  });
}

async function token(
  input: {
    readonly issuer?: string;
    readonly audience?: string;
    readonly issuedAt?: number;
    readonly expiration?: number;
    readonly authTime?: number;
    readonly tokenType?: string;
    readonly principalType?: string;
    readonly acr?: string;
    readonly algorithm?: "RS256" | "RS512";
    readonly signingKey?: CryptoKey;
    readonly header?: Record<string, unknown>;
  } = {},
): Promise<SecretValue> {
  const algorithm = input.algorithm ?? "RS256";
  const jwt = await new SignJWT({
    typ: input.tokenType ?? "Bearer",
    qcrm_principal_type: input.principalType ?? "human",
    acr: input.acr ?? "2",
    auth_time: input.authTime ?? nowSeconds - 60,
  })
    .setProtectedHeader({
      alg: algorithm,
      kid: "trusted-key",
      typ: "JWT",
      ...input.header,
    })
    .setIssuer(input.issuer ?? config.issuer)
    .setAudience(input.audience ?? config.audience)
    .setSubject("keycloak-platform-operator")
    .setIssuedAt(input.issuedAt ?? nowSeconds - 30)
    .setExpirationTime(input.expiration ?? nowSeconds + 120)
    .sign(input.signingKey ?? privateKey);

  return new SecretValue(jwt);
}

describe("Keycloak OIDC access token verifier", () => {
  it("verifies a signed platform token and returns only normalized identity", async () => {
    const identity = await verifier().verifyAccessToken(await token());

    expect(identity).toEqual({
      verification: "oidc-access-token/v1",
      subject: "keycloak-platform-operator",
      issuer: config.issuer,
      audiences: [config.audience],
      principalType: "human",
      multiFactorAuthenticated: true,
      authenticatedAt: new Date((nowSeconds - 60) * 1_000),
    });
    expect(JSON.stringify(identity)).not.toContain("eyJ");
  });

  it.each([
    ["issuer", { issuer: "https://identity.example.test/realms/customer" }],
    ["audience", { audience: "customer-crm-api" }],
    ["expiration", { expiration: nowSeconds - 10 }],
    ["maximum age", { issuedAt: nowSeconds - 310 }],
    ["token type", { tokenType: "Refresh" }],
    ["principal type", { principalType: "service" }],
    ["MFA ACR", { acr: "1" }],
    ["future auth time", { authTime: nowSeconds + 60 }],
  ])("rejects an invalid %s", async (_case, override) => {
    await expect(verifier().verifyAccessToken(await token(override))).rejects.toEqual(
      new OidcAccessTokenVerificationError(),
    );
  });

  it("rejects an algorithm outside the allowlist", async () => {
    const rsa512 = await generateKeyPair("RS512");
    await expect(
      verifier().verifyAccessToken(
        await token({ algorithm: "RS512", signingKey: rsa512.privateKey }),
      ),
    ).rejects.toEqual(new OidcAccessTokenVerificationError());
  });

  it("rejects a token signed by an untrusted key", async () => {
    await expect(
      verifier().verifyAccessToken(await token({ signingKey: attackerPrivateKey })),
    ).rejects.toEqual(new OidcAccessTokenVerificationError());
  });

  it.each([
    ["jku", { jku: "https://attacker.example/jwks.json" }],
    ["jwk", { jwk: { kty: "RSA", n: "attacker", e: "AQAB" } }],
    ["x5u", { x5u: "https://attacker.example/cert.pem" }],
  ])("rejects attacker-controlled %s headers", async (_header, value) => {
    await expect(verifier().verifyAccessToken(await token({ header: value }))).rejects.toEqual(
      new OidcAccessTokenVerificationError(),
    );
  });

  it("normalizes malformed input without exposing it", async () => {
    const canary = "sensitive-token-canary";
    try {
      await verifier().verifyAccessToken(new SecretValue(canary));
    } catch (error) {
      expect(error).toEqual(new OidcAccessTokenVerificationError());
      expect(String(error)).not.toContain(canary);
    }
  });
});
