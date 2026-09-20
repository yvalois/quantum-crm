import { createServer } from "node:http";

import { createKeycloakOidcAccessTokenVerifier } from "@quantum-crm/auth";
import { parseOidcConfig, SecretValue } from "@quantum-crm/config";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const server = createServer();
let issuer = "";
let requests = 0;
let tokenValue = "";

beforeAll(async () => {
  const first = await generateKeyPair("RS256");
  const active = await generateKeyPair("RS256");
  const firstJwk = { ...(await exportJWK(first.publicKey)), kid: "previous-key", alg: "RS256" };
  const activeJwk = { ...(await exportJWK(active.publicKey)), kid: "active-key", alg: "RS256" };

  server.on("request", (request, response) => {
    requests += 1;
    if (
      request.method !== "GET" ||
      request.url !== "/realms/quantum-platform/protocol/openid-connect/certs"
    ) {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [firstJwk, activeJwk] }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("JWKS integration server did not expose a TCP port");
  }

  issuer = `http://127.0.0.1:${address.port}/realms/quantum-platform`;
  const now = Math.floor(Date.now() / 1_000);
  tokenValue = await new SignJWT({
    typ: "Bearer",
    qcrm_principal_type: "human",
    acr: "2",
    auth_time: now - 30,
  })
    .setProtectedHeader({ alg: "RS256", kid: "active-key", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience("quantum-admin-api")
    .setSubject("remote-jwks-operator")
    .setIssuedAt(now - 10)
    .setExpirationTime(now + 120)
    .sign(active.privateKey);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("remote Keycloak JWKS verification", () => {
  it("selects the trusted kid and reuses the bounded JWKS cache", async () => {
    const config = parseOidcConfig(
      "admin-api",
      { provider: "keycloak", boundary: "platform" },
      "test",
      {
        QCRM_OIDC_ISSUER: issuer,
        QCRM_OIDC_AUDIENCE: "quantum-admin-api",
        QCRM_OIDC_REQUIRED_ACR: "2",
      },
    );
    const verifier = createKeycloakOidcAccessTokenVerifier(config);
    const token = new SecretValue(tokenValue);

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: "remote-jwks-operator",
      issuer,
      multiFactorAuthenticated: true,
    });
    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      subject: "remote-jwks-operator",
    });
    expect(requests).toBe(1);
  });
});
