import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { createClient } from "redis";

import {
  tenantOidcIdentity,
  type TenantIdentityProvisioner,
  type TenantIdentityProvisioningCommand,
  type TenantIdentityProvisioningResult,
} from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hostnamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[0-9-]+\.nip\.io$/u;

type ProvisioningFailureReason =
  "UNAVAILABLE" | "PERMISSION_DENIED" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT";

interface KeycloakRealm {
  readonly realm?: unknown;
  readonly enabled?: unknown;
  readonly registrationAllowed?: unknown;
  readonly bruteForceProtected?: unknown;
  readonly otpPolicyType?: unknown;
  readonly requiredActions?: unknown;
}

interface KeycloakRequiredAction {
  readonly alias?: unknown;
  readonly providerId?: unknown;
  readonly enabled?: unknown;
  readonly defaultAction?: unknown;
  readonly priority?: unknown;
}

const activationCompletionAction = "QCRM_ACTIVATION_COMPLETE";

interface KeycloakClient {
  readonly id?: unknown;
  readonly clientId?: unknown;
  readonly protocol?: unknown;
  readonly publicClient?: unknown;
  readonly standardFlowEnabled?: unknown;
  readonly directAccessGrantsEnabled?: unknown;
  readonly implicitFlowEnabled?: unknown;
  readonly serviceAccountsEnabled?: unknown;
  readonly redirectUris?: unknown;
  readonly webOrigins?: unknown;
  readonly attributes?: unknown;
  readonly protocolMappers?: unknown;
}

export class TenantIdentityProvisioningError extends Error {
  public constructor(public readonly reason: ProvisioningFailureReason) {
    super(`Tenant identity provisioning failed: ${reason}`);
    this.name = "TenantIdentityProvisioningError";
  }
}

export interface TenantIdentityProvisionerOptions {
  readonly keycloakAdminOrigin: string;
  readonly keycloakProvisionerClientId: string;
  readonly keycloakProvisionerClientSecret: string;
  readonly identityOrigin: string;
  readonly redisAdminUrl: string;
  readonly tenantSecretDirectory: string;
}

function secretPath(rootDirectory: string, tenantProfileId: string, fileName: string): string {
  const root = resolve(rootDirectory);
  const path = resolve(root, tenantProfileId, fileName);
  if (path === root || !path.startsWith(`${root}${sep}`)) {
    throw new TenantIdentityProvisioningError("IDENTITY_MISMATCH");
  }
  return path;
}

function safeSecret(value: string): string {
  const normalized = value.replace(/\r?\n$/u, "");
  if (!normalized || normalized.length > 16_384 || /[\0\r\n]/u.test(normalized)) {
    throw new TenantIdentityProvisioningError("IDENTITY_MISMATCH");
  }
  return normalized;
}

async function readSecret(path: string): Promise<string | undefined> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > 16_385
    ) {
      throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
    }
    return safeSecret(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof TenantIdentityProvisioningError) throw error;
    if ((error as { readonly code?: string }).code === "ENOENT") return undefined;
    if (["EACCES", "EPERM"].includes((error as { readonly code?: string }).code ?? "")) {
      throw new TenantIdentityProvisioningError("PERMISSION_DENIED");
    }
    throw new TenantIdentityProvisioningError("UNAVAILABLE");
  }
}

async function writeSecretIfMissing(path: string, value: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const existing = await readSecret(path);
  if (existing !== undefined) {
    if (existing !== value) throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
    await chmod(path, 0o400);
    return true;
  }
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o400);
    await handle.writeFile(`${value}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await chmod(path, 0o400);
    return false;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if ((error as { readonly code?: string }).code === "EEXIST") {
      const current = await readSecret(path);
      if (current === value) return true;
      throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
    }
    if (["EACCES", "EPERM"].includes((error as { readonly code?: string }).code ?? "")) {
      throw new TenantIdentityProvisioningError("PERMISSION_DENIED");
    }
    throw new TenantIdentityProvisioningError("UNAVAILABLE");
  }
}

function exactOrigin(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  if (!hostnamePattern.test(normalized)) {
    throw new TenantIdentityProvisioningError("IDENTITY_MISMATCH");
  }
  return `https://${normalized}`;
}

function assertRealm(realm: KeycloakRealm, realmName: string): void {
  const completionActions = Array.isArray(realm.requiredActions)
    ? realm.requiredActions.filter((action) => {
        if (typeof action !== "object" || action === null) return false;
        const requiredAction = action as KeycloakRequiredAction;
        return (
          requiredAction.alias === activationCompletionAction &&
          requiredAction.providerId === activationCompletionAction
        );
      })
    : [];
  const completionAction = completionActions[0] as KeycloakRequiredAction | undefined;
  if (
    realm.realm !== realmName ||
    realm.enabled !== true ||
    realm.registrationAllowed !== false ||
    realm.bruteForceProtected !== true ||
    realm.otpPolicyType !== "totp" ||
    completionActions.length !== 1 ||
    completionAction?.enabled !== true ||
    completionAction.defaultAction !== false ||
    completionAction.priority !== 1_000
  ) {
    throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
  }
}

function assertClient(client: KeycloakClient, clientId: string, origin: string): string {
  const attributes = client.attributes;
  const audienceMapper = Array.isArray(client.protocolMappers)
    ? client.protocolMappers.find(
        (mapper) =>
          typeof mapper === "object" &&
          mapper !== null &&
          (mapper as Record<string, unknown>).name === "quantum-crm-api-audience",
      )
    : undefined;
  const audienceConfig =
    typeof audienceMapper === "object" && audienceMapper !== null
      ? (audienceMapper as Record<string, unknown>).config
      : undefined;
  if (
    typeof client.id !== "string" ||
    client.clientId !== clientId ||
    client.protocol !== "openid-connect" ||
    client.publicClient !== false ||
    client.standardFlowEnabled !== true ||
    client.directAccessGrantsEnabled !== false ||
    client.implicitFlowEnabled !== false ||
    client.serviceAccountsEnabled !== false ||
    !Array.isArray(client.redirectUris) ||
    client.redirectUris.length !== 1 ||
    client.redirectUris[0] !== `${origin}/api/auth/callback/keycloak` ||
    !Array.isArray(client.webOrigins) ||
    client.webOrigins.length !== 1 ||
    client.webOrigins[0] !== origin ||
    typeof attributes !== "object" ||
    attributes === null ||
    (attributes as Record<string, unknown>)["pkce.code.challenge.method"] !== "S256" ||
    typeof audienceMapper !== "object" ||
    audienceMapper === null ||
    (audienceMapper as Record<string, unknown>).protocol !== "openid-connect" ||
    (audienceMapper as Record<string, unknown>).protocolMapper !== "oidc-audience-mapper" ||
    typeof audienceConfig !== "object" ||
    audienceConfig === null ||
    (audienceConfig as Record<string, unknown>)["included.client.audience"] !== "quantum-crm-api" ||
    (audienceConfig as Record<string, unknown>)["access.token.claim"] !== "true"
  ) {
    throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
  }
  return client.id;
}

function assertBootstrapClient(client: KeycloakClient): string {
  const mapper = Array.isArray(client.protocolMappers)
    ? client.protocolMappers.find(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).name === "iam-bootstrap-permission",
      )
    : undefined;
  const audience = Array.isArray(client.protocolMappers)
    ? client.protocolMappers.find(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).name === "quantum-crm-api-audience",
      )
    : undefined;
  const principal = Array.isArray(client.protocolMappers)
    ? client.protocolMappers.find(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as Record<string, unknown>).name === "qcrm-service-principal",
      )
    : undefined;
  const config =
    typeof mapper === "object" && mapper !== null
      ? (mapper as Record<string, unknown>).config
      : undefined;
  const audienceConfig =
    typeof audience === "object" && audience !== null
      ? (audience as Record<string, unknown>).config
      : undefined;
  const principalConfig =
    typeof principal === "object" && principal !== null
      ? (principal as Record<string, unknown>).config
      : undefined;
  if (
    typeof client.id !== "string" ||
    client.clientId !== "quantum-crm-bootstrap" ||
    client.protocol !== "openid-connect" ||
    client.publicClient !== false ||
    client.standardFlowEnabled !== false ||
    client.directAccessGrantsEnabled !== false ||
    client.implicitFlowEnabled !== false ||
    client.serviceAccountsEnabled !== true ||
    !Array.isArray(client.redirectUris) ||
    client.redirectUris.length !== 0 ||
    !Array.isArray(client.webOrigins) ||
    client.webOrigins.length !== 0 ||
    typeof mapper !== "object" ||
    mapper === null ||
    (mapper as Record<string, unknown>).protocolMapper !== "oidc-hardcoded-claim-mapper" ||
    typeof config !== "object" ||
    config === null ||
    (config as Record<string, unknown>)["claim.name"] !== "scope" ||
    (config as Record<string, unknown>)["claim.value"] !==
      "iam:bootstrap-initial-administrator iam:accept-member-invitation" ||
    typeof audience !== "object" ||
    audience === null ||
    (audience as Record<string, unknown>).protocolMapper !== "oidc-audience-mapper" ||
    typeof audienceConfig !== "object" ||
    audienceConfig === null ||
    (audienceConfig as Record<string, unknown>)["included.client.audience"] !== "quantum-crm-api" ||
    typeof principal !== "object" ||
    principal === null ||
    (principal as Record<string, unknown>).protocolMapper !== "oidc-hardcoded-claim-mapper" ||
    typeof principalConfig !== "object" ||
    principalConfig === null ||
    (principalConfig as Record<string, unknown>)["claim.name"] !== "qcrm_principal_type" ||
    (principalConfig as Record<string, unknown>)["claim.value"] !== "service"
  )
    throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
  return client.id;
}

function realmRepresentation(realmName: string): Record<string, unknown> {
  return {
    realm: realmName,
    enabled: true,
    registrationAllowed: false,
    bruteForceProtected: true,
    otpPolicyType: "totp",
    requiredActions: [
      {
        alias: activationCompletionAction,
        name: "Complete Quantum activation",
        providerId: activationCompletionAction,
        enabled: true,
        defaultAction: false,
        priority: 1_000,
        config: {},
      },
    ],
  };
}

function clientRepresentation(clientId: string, origin: string): Record<string, unknown> {
  return {
    clientId,
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: [`${origin}/api/auth/callback/keycloak`],
    webOrigins: [origin],
    attributes: { "pkce.code.challenge.method": "S256" },
    protocolMappers: [
      {
        name: "quantum-crm-api-audience",
        protocol: "openid-connect",
        protocolMapper: "oidc-audience-mapper",
        config: {
          "included.client.audience": "quantum-crm-api",
          "access.token.claim": "true",
          "id.token.claim": "false",
        },
      },
    ],
  };
}

function bootstrapClientRepresentation(): Record<string, unknown> {
  return {
    clientId: "quantum-crm-bootstrap",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
    serviceAccountsEnabled: true,
    redirectUris: [],
    webOrigins: [],
    protocolMappers: [
      {
        name: "iam-bootstrap-permission",
        protocol: "openid-connect",
        protocolMapper: "oidc-hardcoded-claim-mapper",
        config: {
          "claim.name": "scope",
          "claim.value": "iam:bootstrap-initial-administrator iam:accept-member-invitation",
          "access.token.claim": "true",
          "id.token.claim": "false",
          "userinfo.token.claim": "false",
          "jsonType.label": "String",
        },
      },
      {
        name: "qcrm-service-principal",
        protocol: "openid-connect",
        protocolMapper: "oidc-hardcoded-claim-mapper",
        config: {
          "claim.name": "qcrm_principal_type",
          "claim.value": "service",
          "access.token.claim": "true",
          "id.token.claim": "false",
          "userinfo.token.claim": "false",
          "jsonType.label": "String",
        },
      },
      {
        name: "quantum-crm-api-audience",
        protocol: "openid-connect",
        protocolMapper: "oidc-audience-mapper",
        config: {
          "included.client.audience": "quantum-crm-api",
          "access.token.claim": "true",
          "id.token.claim": "false",
        },
      },
    ],
  };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function request(
  url: URL,
  init: RequestInit,
  acceptable: readonly number[],
): Promise<{ readonly status: number; readonly body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await responseBody(response);
    if (acceptable.includes(response.status)) return { status: response.status, body };
    if (response.status === 401 || response.status === 403) {
      throw new TenantIdentityProvisioningError("PERMISSION_DENIED");
    }
    if (response.status === 409) throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
    throw new TenantIdentityProvisioningError("UNAVAILABLE");
  } catch (error) {
    if (error instanceof TenantIdentityProvisioningError) throw error;
    throw new TenantIdentityProvisioningError("UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

async function keycloakAccessToken(options: TenantIdentityProvisionerOptions): Promise<string> {
  const origin = new URL(options.keycloakAdminOrigin);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: options.keycloakProvisionerClientId,
    client_secret: options.keycloakProvisionerClientSecret,
  });
  const response = await request(
    new URL("/realms/master/protocol/openid-connect/token", origin),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    [200],
  );
  const token =
    typeof response.body === "object" && response.body !== null
      ? (response.body as Record<string, unknown>).access_token
      : undefined;
  if (typeof token !== "string" || token.length < 20 || /[\0\r\n]/u.test(token)) {
    throw new TenantIdentityProvisioningError("UNAVAILABLE");
  }
  return token;
}

async function provisionKeycloak(
  options: TenantIdentityProvisionerOptions,
  realmName: string,
  clientId: string,
  origin: string,
): Promise<string> {
  const adminOrigin = new URL(options.keycloakAdminOrigin);
  const token = await keycloakAccessToken(options);
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const realmUrl = new URL(`/admin/realms/${encodeURIComponent(realmName)}`, adminOrigin);
  let realm = await request(realmUrl, { headers }, [200, 404]);
  let reconciled = realm.status === 200;
  if (realm.status === 404) {
    try {
      await request(
        new URL("/admin/realms", adminOrigin),
        { method: "POST", headers, body: JSON.stringify(realmRepresentation(realmName)) },
        [201],
      );
    } catch (error) {
      if (
        !(error instanceof TenantIdentityProvisioningError) ||
        error.reason !== "TARGET_CONFLICT"
      ) {
        throw error;
      }
    }
    realm = await request(realmUrl, { headers }, [200]);
  }
  if (typeof realm.body !== "object" || realm.body === null) {
    throw new TenantIdentityProvisioningError("UNAVAILABLE");
  }
  assertRealm(realm.body as KeycloakRealm, realmName);

  const clientsUrl = new URL(`/admin/realms/${encodeURIComponent(realmName)}/clients`, adminOrigin);
  clientsUrl.searchParams.set("clientId", clientId);
  let clients = await request(clientsUrl, { headers }, [200]);
  if (!Array.isArray(clients.body)) throw new TenantIdentityProvisioningError("UNAVAILABLE");
  if (clients.body.length === 0) {
    try {
      await request(
        clientsUrl,
        { method: "POST", headers, body: JSON.stringify(clientRepresentation(clientId, origin)) },
        [201],
      );
    } catch (error) {
      if (
        !(error instanceof TenantIdentityProvisioningError) ||
        error.reason !== "TARGET_CONFLICT"
      ) {
        throw error;
      }
    }
    clients = await request(clientsUrl, { headers }, [200]);
    reconciled = false;
  }
  if (!Array.isArray(clients.body) || clients.body.length !== 1) {
    throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
  }
  const clientUuid = assertClient(clients.body[0] as KeycloakClient, clientId, origin);
  const secret = await request(
    new URL(
      `/admin/realms/${encodeURIComponent(realmName)}/clients/${encodeURIComponent(clientUuid)}/client-secret`,
      adminOrigin,
    ),
    { headers },
    [200],
  );
  const value =
    typeof secret.body === "object" && secret.body !== null
      ? (secret.body as Record<string, unknown>).value
      : undefined;
  if (typeof value !== "string") throw new TenantIdentityProvisioningError("UNAVAILABLE");
  return `${reconciled ? "r" : "c"}:${safeSecret(value)}`;
}

async function provisionBootstrapClient(
  options: TenantIdentityProvisionerOptions,
  realmName: string,
): Promise<string> {
  const adminOrigin = new URL(options.keycloakAdminOrigin);
  const headers = {
    authorization: `Bearer ${await keycloakAccessToken(options)}`,
    "content-type": "application/json",
  };
  const clientsUrl = new URL(`/admin/realms/${encodeURIComponent(realmName)}/clients`, adminOrigin);
  clientsUrl.searchParams.set("clientId", "quantum-crm-bootstrap");
  let clients = await request(clientsUrl, { headers }, [200]);
  if (!Array.isArray(clients.body)) throw new TenantIdentityProvisioningError("UNAVAILABLE");
  if (clients.body.length === 0) {
    await request(
      clientsUrl,
      { method: "POST", headers, body: JSON.stringify(bootstrapClientRepresentation()) },
      [201, 409],
    );
    clients = await request(clientsUrl, { headers }, [200]);
  }
  if (!Array.isArray(clients.body) || clients.body.length !== 1)
    throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
  const clientUuid = assertBootstrapClient(clients.body[0] as KeycloakClient);
  const secret = await request(
    new URL(
      `/admin/realms/${encodeURIComponent(realmName)}/clients/${encodeURIComponent(clientUuid)}/client-secret`,
      adminOrigin,
    ),
    { headers },
    [200],
  );
  const value =
    typeof secret.body === "object" && secret.body !== null
      ? (secret.body as Record<string, unknown>).value
      : undefined;
  if (typeof value !== "string") throw new TenantIdentityProvisioningError("UNAVAILABLE");
  return safeSecret(value);
}

async function provisionRedisAcl(
  redisAdminUrl: string,
  tenantProfileId: string,
  password: string,
): Promise<void> {
  const compact = tenantProfileId.replaceAll("-", "");
  const username = `qcrm_s_${compact}`;
  const client = createClient({ url: redisAdminUrl, socket: { connectTimeout: 5_000 } });
  try {
    await client.connect();
    await client.sendCommand([
      "ACL",
      "SETUSER",
      username,
      "on",
      "resetpass",
      `>${password}`,
      `~qcrm:crm:${tenantProfileId}:*`,
      "+@all",
      "-@dangerous",
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/NOPERM|WRONGPASS|NOAUTH|AUTH failed/iu.test(message)) {
      throw new TenantIdentityProvisioningError("PERMISSION_DENIED");
    }
    throw new TenantIdentityProvisioningError("UNAVAILABLE");
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

export function createTenantIdentityProvisioner(
  options: TenantIdentityProvisionerOptions,
): TenantIdentityProvisioner {
  const provision = async (
    command: TenantIdentityProvisioningCommand,
  ): Promise<TenantIdentityProvisioningResult> => {
    if (!uuidPattern.test(command.tenantProfileId) || !uuidPattern.test(command.serverId)) {
      throw new TenantIdentityProvisioningError("IDENTITY_MISMATCH");
    }
    const identity = tenantOidcIdentity(command.tenantProfileId);
    const origin = exactOrigin(command.hostname);
    if (new URL(options.identityOrigin).protocol !== "https:") {
      throw new TenantIdentityProvisioningError("IDENTITY_MISMATCH");
    }
    const keycloakSecret = await provisionKeycloak(
      options,
      identity.realmName,
      identity.crmWebClientId,
      origin,
    );
    const bootstrapSecret = await provisionBootstrapClient(options, identity.realmName);
    const clientSecretPath = secretPath(
      options.tenantSecretDirectory,
      identity.tenantProfileId,
      "oidc-client-secret",
    );
    const redisUrlPath = secretPath(
      options.tenantSecretDirectory,
      identity.tenantProfileId,
      "session-redis-url",
    );
    const bootstrapSecretPath = secretPath(
      options.tenantSecretDirectory,
      identity.tenantProfileId,
      "iam-bootstrap-client-secret",
    );
    const clientSecretReconciled = await writeSecretIfMissing(
      clientSecretPath,
      keycloakSecret.slice(2),
    );
    const bootstrapSecretReconciled = await writeSecretIfMissing(
      bootstrapSecretPath,
      bootstrapSecret,
    );
    const existingRedisUrl = await readSecret(redisUrlPath);
    const username = `qcrm_s_${identity.tenantProfileId.replaceAll("-", "")}`;
    const password = existingRedisUrl
      ? (() => {
          const parsed = new URL(existingRedisUrl);
          if (parsed.username !== username || !parsed.password || parsed.pathname !== "/0") {
            throw new TenantIdentityProvisioningError("TARGET_CONFLICT");
          }
          return decodeURIComponent(parsed.password);
        })()
      : randomBytes(48).toString("base64url");
    const redisUrl = new URL(options.redisAdminUrl);
    redisUrl.username = username;
    redisUrl.password = password;
    redisUrl.pathname = "/0";
    redisUrl.search = "";
    redisUrl.hash = "";
    const redisSecretReconciled = await writeSecretIfMissing(redisUrlPath, redisUrl.toString());
    await provisionRedisAcl(options.redisAdminUrl, identity.tenantProfileId, password);
    return Object.freeze({
      identity,
      reconciled:
        clientSecretReconciled &&
        bootstrapSecretReconciled &&
        redisSecretReconciled &&
        keycloakSecret.startsWith("r:"),
    });
  };

  return Object.freeze({ provision });
}
