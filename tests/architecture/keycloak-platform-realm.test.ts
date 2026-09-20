import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const realmPath = new URL("../../infra/keycloak/quantum-platform-realm.json", import.meta.url);

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

async function realm(): Promise<JsonObject> {
  return object(JSON.parse(await readFile(realmPath, "utf8")));
}

describe("Keycloak platform realm", () => {
  it("contains no identities, credentials, secrets or wildcard origins", async () => {
    const configuration = await realm();
    const serialized = JSON.stringify(configuration);

    expect(configuration.users).toBeUndefined();
    expect(serialized).not.toMatch(/"(?:secret|credentials?|password|value)"\s*:/iu);
    expect(serialized).not.toContain('"*"');
    expect(configuration.registrationAllowed).toBe(false);
    expect(configuration.rememberMe).toBe(false);
    expect(configuration.bruteForceProtected).toBe(true);
  });

  it("defines only the hardened confidential admin web client", async () => {
    const configuration = await realm();
    const clients = array(configuration.clients).map(object);
    expect(clients).toHaveLength(1);

    const client = clients[0]!;
    expect(client).toMatchObject({
      clientId: "quantum-admin-web",
      clientAuthenticatorType: "client-secret",
      publicClient: false,
      bearerOnly: false,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: ["${QCRM_ADMIN_WEB_ORIGIN}/api/auth/callback/keycloak"],
      webOrigins: ["${QCRM_ADMIN_WEB_ORIGIN}"],
    });
    expect(object(client.attributes)).toMatchObject({
      "pkce.code.challenge.method": "S256",
      "oauth2.device.authorization.grant.enabled": "false",
      "oidc.ciba.grant.enabled": "false",
      "default.acr.values": "2",
      "minimum.acr.value": "2",
    });
  });

  it("maps the API audience and human principal only into access tokens", async () => {
    const configuration = await realm();
    const client = object(array(configuration.clients)[0]);
    const mappers = array(client.protocolMappers).map(object);

    expect(mappers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          protocolMapper: "oidc-audience-mapper",
          config: expect.objectContaining({
            "included.custom.audience": "quantum-admin-api",
            "id.token.claim": "false",
            "access.token.claim": "true",
          }),
        }),
        expect.objectContaining({
          protocolMapper: "oidc-hardcoded-claim-mapper",
          config: expect.objectContaining({
            "claim.name": "qcrm_principal_type",
            "claim.value": "human",
            "access.token.claim": "true",
          }),
        }),
      ]),
    );
  });

  it("binds ordered password and OTP authentication levels to the browser", async () => {
    const configuration = await realm();
    const flows = array(configuration.authenticationFlows).map(object);
    const loa1 = flows.find((flow) => flow.alias === "quantum-platform-loa-1");
    const loa2 = flows.find((flow) => flow.alias === "quantum-platform-loa-2");

    expect(configuration).toMatchObject({
      realm: "quantum-platform",
      browserFlow: "quantum-platform-browser",
      otpPolicyType: "totp",
      accessTokenLifespan: 300,
      attributes: { "acr.loa.map": '{"1":1,"2":2}' },
    });
    expect(array(object(loa1).authenticationExecutions).map(object)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authenticator: "auth-username-password-form" }),
      ]),
    );
    expect(array(object(loa2).authenticationExecutions).map(object)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authenticator: "auth-otp-form",
          requirement: "REQUIRED",
        }),
      ]),
    );
    expect(array(configuration.requiredActions).map(object)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: "CONFIGURE_TOTP",
          enabled: true,
          defaultAction: true,
        }),
      ]),
    );
  });
});
