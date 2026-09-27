import {
  platformReleaseArtifactNames,
  tenantContainerServiceNames,
  type PlatformReleaseArtifactName,
  type TenantContainerServiceName,
} from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const absolutePathPattern = /^\/(?!\/)[^\0\r\n]*$/u;
const registryPattern = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,254}$/u;
const networkPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/u;

export const tenantEdgeRouteServiceNames = ["crm-web", "portal-web", "api"] as const;
export type TenantEdgeRouteServiceName = (typeof tenantEdgeRouteServiceNames)[number];

const tenantArtifactByService: Readonly<
  Record<TenantContainerServiceName, PlatformReleaseArtifactName>
> = Object.freeze({
  "crm-web": "CRM_WEB",
  "portal-web": "PORTAL_WEB",
  api: "API",
  worker: "WORKER",
  "agent-runtime": "AGENT_RUNTIME",
});

const manifestKeys = new Set([
  "schemaVersion",
  "tenantProfileId",
  "serverId",
  "releaseId",
  "release",
  "database",
  "storage",
  "identity",
]);

export class ComposePolicyValidationError extends Error {
  public constructor(public readonly field: string) {
    super(`Invalid tenant compose policy field: ${field}`);
    this.name = "ComposePolicyValidationError";
  }
}

export interface ComposePolicyRequest {
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly projectName: string;
}

export interface TenantConfigurationManifest {
  readonly schemaVersion: 1;
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly releaseId: string;
  readonly release: {
    readonly id: string;
    readonly version: string;
    readonly artifacts: readonly {
      readonly name: PlatformReleaseArtifactName;
      readonly digest: string;
    }[];
  };
  readonly identity: {
    readonly crmWebOrigin: string;
    readonly issuer: string;
    readonly crmWebClientId: "quantum-crm-web";
    readonly apiAudience: "quantum-crm-api";
  };
}

export interface ComposePolicyOptions {
  readonly templatePath: string;
  readonly imageRegistry: string;
  readonly environment: "preview" | "staging" | "production";
  readonly tenantEdgeNetwork: string;
  readonly platformDatabaseNetwork: string;
  readonly platformStorageNetwork: string;
  readonly platformSessionNetwork: string;
  readonly platformOidcNetwork: string;
  readonly crmDatabaseSecretFile: string;
  readonly crmMigrationDatabaseSecretFile: string;
  readonly crmOidcClientSecretFile: string;
  readonly crmSessionRedisUrlSecretFile: string;
}

export function tenantEdgeNetworkName(prefix: string, tenantProfileId: string): string {
  if (!networkPattern.test(prefix) || !uuidPattern.test(tenantProfileId)) {
    throw new ComposePolicyValidationError("tenantEdgeNetwork");
  }
  const name = `${prefix}-${tenantProfileId}`;
  if (!networkPattern.test(name)) throw new ComposePolicyValidationError("tenantEdgeNetwork");
  return name;
}

export function tenantEdgeServiceAlias(
  tenantProfileId: string,
  service: TenantEdgeRouteServiceName,
): string {
  if (!uuidPattern.test(tenantProfileId) || !tenantEdgeRouteServiceNames.includes(service)) {
    throw new ComposePolicyValidationError("tenantEdgeServiceAlias");
  }
  const alias = `qcrm-${tenantProfileId.replaceAll("-", "")}-${service}`;
  if (!networkPattern.test(alias)) throw new ComposePolicyValidationError("tenantEdgeServiceAlias");
  return alias;
}

export function tenantBootstrapApiAlias(tenantProfileId: string): string {
  if (!uuidPattern.test(tenantProfileId))
    throw new ComposePolicyValidationError("tenantBootstrapApiAlias");
  return `qcrm-${tenantProfileId.replaceAll("-", "")}-bootstrap-api`;
}

export interface TenantComposePlan {
  readonly projectName: string;
  readonly templatePath: string;
  readonly services: readonly TenantContainerServiceName[];
  readonly environment: Readonly<Record<string, string>>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new ComposePolicyValidationError(field);
  }
  return value;
}

function requireUuid(value: unknown, field: string): string {
  const normalized = requireString(value, field);
  if (!uuidPattern.test(normalized)) throw new ComposePolicyValidationError(field);
  return normalized;
}

function requireAbsolutePath(value: string, field: string): string {
  if (value.length > 255 || !absolutePathPattern.test(value) || value === "/") {
    throw new ComposePolicyValidationError(field);
  }
  return value;
}

export function parseTenantConfigurationManifest(
  value: unknown,
  request: ComposePolicyRequest,
): TenantConfigurationManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ComposePolicyValidationError("manifest");
  }
  const input = value as Record<string, unknown>;
  if ([...Object.keys(input)].some((key) => !manifestKeys.has(key))) {
    throw new ComposePolicyValidationError("manifest");
  }
  if (input.schemaVersion !== 1) throw new ComposePolicyValidationError("schemaVersion");
  const tenantProfileId = requireUuid(input.tenantProfileId, "tenantProfileId");
  const serverId = requireUuid(input.serverId, "serverId");
  const releaseId = requireUuid(input.releaseId, "releaseId");
  if (
    tenantProfileId !== request.tenantProfileId ||
    serverId !== request.serverId ||
    releaseId !== request.releaseId
  ) {
    throw new ComposePolicyValidationError("identity");
  }
  if (typeof input.release !== "object" || input.release === null || Array.isArray(input.release)) {
    throw new ComposePolicyValidationError("release");
  }
  const release = input.release as Record<string, unknown>;
  const releaseManifestId = requireUuid(release.id, "release.id");
  const version = requireString(release.version, "release.version");
  if (releaseManifestId !== releaseId || !/^[1-9][0-9]*$/u.test(version)) {
    throw new ComposePolicyValidationError("release");
  }
  if (
    !Array.isArray(release.artifacts) ||
    release.artifacts.length !== platformReleaseArtifactNames.length
  ) {
    throw new ComposePolicyValidationError("release.artifacts");
  }
  const artifacts = new Map<PlatformReleaseArtifactName, string>();
  for (const artifact of release.artifacts) {
    if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
      throw new ComposePolicyValidationError("release.artifacts");
    }
    const candidate = artifact as Record<string, unknown>;
    const name = candidate.name;
    const digest = candidate.digest;
    if (
      typeof name !== "string" ||
      !platformReleaseArtifactNames.includes(name as PlatformReleaseArtifactName) ||
      typeof digest !== "string" ||
      !digestPattern.test(digest) ||
      artifacts.has(name as PlatformReleaseArtifactName)
    ) {
      throw new ComposePolicyValidationError("release.artifacts");
    }
    artifacts.set(name as PlatformReleaseArtifactName, digest);
  }
  if (platformReleaseArtifactNames.some((name) => !artifacts.has(name))) {
    throw new ComposePolicyValidationError("release.artifacts");
  }
  if (
    typeof input.identity !== "object" ||
    input.identity === null ||
    Array.isArray(input.identity)
  ) {
    throw new ComposePolicyValidationError("identity");
  }
  const identity = input.identity as Record<string, unknown>;
  const crmWebOrigin = requireString(identity.crmWebOrigin, "identity.crmWebOrigin");
  const issuer = requireString(identity.issuer, "identity.issuer");
  let webOrigin: URL;
  let issuerUrl: URL;
  try {
    webOrigin = new URL(crmWebOrigin);
    issuerUrl = new URL(issuer);
  } catch {
    throw new ComposePolicyValidationError("identity");
  }
  if (
    webOrigin.protocol !== "https:" ||
    webOrigin.pathname !== "/" ||
    webOrigin.search ||
    webOrigin.hash ||
    issuerUrl.protocol !== "https:" ||
    !/^\/realms\/qcrm-[0-9a-f]{32}$/u.test(issuerUrl.pathname) ||
    identity.crmWebClientId !== "quantum-crm-web" ||
    identity.apiAudience !== "quantum-crm-api"
  ) {
    throw new ComposePolicyValidationError("identity");
  }
  return Object.freeze({
    schemaVersion: 1,
    tenantProfileId,
    serverId,
    releaseId,
    release: Object.freeze({
      id: releaseManifestId,
      version,
      artifacts: Object.freeze(
        platformReleaseArtifactNames.map((name) =>
          Object.freeze({ name, digest: artifacts.get(name) as string }),
        ),
      ),
    }),
    identity: Object.freeze({
      crmWebOrigin: webOrigin.origin,
      issuer: issuerUrl.toString().replace(/\/$/u, ""),
      crmWebClientId: "quantum-crm-web" as const,
      apiAudience: "quantum-crm-api" as const,
    }),
  });
}

export function createTenantComposePlan(
  request: ComposePolicyRequest,
  manifest: TenantConfigurationManifest,
  options: ComposePolicyOptions,
): TenantComposePlan {
  if (request.projectName !== `qcrm-t-${request.tenantProfileId}`) {
    throw new ComposePolicyValidationError("projectName");
  }
  if (
    manifest.tenantProfileId !== request.tenantProfileId ||
    manifest.serverId !== request.serverId ||
    manifest.releaseId !== request.releaseId
  ) {
    throw new ComposePolicyValidationError("identity");
  }
  const templatePath = requireAbsolutePath(options.templatePath, "templatePath");
  const crmDatabaseSecretFile = requireAbsolutePath(
    options.crmDatabaseSecretFile,
    "crmDatabaseSecretFile",
  );
  const crmMigrationDatabaseSecretFile = requireAbsolutePath(
    options.crmMigrationDatabaseSecretFile,
    "crmMigrationDatabaseSecretFile",
  );
  const crmOidcClientSecretFile = requireAbsolutePath(
    options.crmOidcClientSecretFile,
    "crmOidcClientSecretFile",
  );
  const crmSessionRedisUrlSecretFile = requireAbsolutePath(
    options.crmSessionRedisUrlSecretFile,
    "crmSessionRedisUrlSecretFile",
  );
  if (!registryPattern.test(options.imageRegistry)) {
    throw new ComposePolicyValidationError("imageRegistry");
  }
  if (
    !networkPattern.test(options.tenantEdgeNetwork) ||
    !networkPattern.test(options.platformDatabaseNetwork) ||
    !networkPattern.test(options.platformStorageNetwork) ||
    !networkPattern.test(options.platformSessionNetwork) ||
    !networkPattern.test(options.platformOidcNetwork)
  ) {
    throw new ComposePolicyValidationError("network");
  }
  const artifacts = new Map(
    manifest.release.artifacts.map((artifact) => [artifact.name, artifact.digest]),
  );
  const environment: Record<string, string> = {
    QCRM_ENV: options.environment,
    QCRM_IMAGE_REGISTRY: options.imageRegistry,
    QCRM_TENANT_ID: request.tenantProfileId,
    QCRM_TENANT_EDGE_NETWORK: options.tenantEdgeNetwork,
    QCRM_PLATFORM_DATABASE_NETWORK: options.platformDatabaseNetwork,
    QCRM_PLATFORM_STORAGE_NETWORK: options.platformStorageNetwork,
    QCRM_PLATFORM_SESSION_NETWORK: options.platformSessionNetwork,
    QCRM_PLATFORM_OIDC_NETWORK: options.platformOidcNetwork,
    QCRM_CRM_DATABASE_URL_SECRET_FILE: crmDatabaseSecretFile,
    QCRM_CRM_MIGRATION_DATABASE_URL_SECRET_FILE: crmMigrationDatabaseSecretFile,
    QCRM_CRM_OIDC_CLIENT_SECRET_FILE: crmOidcClientSecretFile,
    QCRM_CRM_SESSION_REDIS_URL_SECRET_FILE: crmSessionRedisUrlSecretFile,
    QCRM_CRM_WEB_ORIGIN: manifest.identity.crmWebOrigin,
    QCRM_CRM_API_ORIGIN: "http://api:3001",
    QCRM_OIDC_ISSUER: manifest.identity.issuer,
    QCRM_OIDC_CLIENT_ID: manifest.identity.crmWebClientId,
    QCRM_OIDC_AUDIENCE: manifest.identity.apiAudience,
    QCRM_IAM_BOOTSTRAP_CLIENT_ID: "quantum-crm-bootstrap",
    QCRM_OIDC_REQUIRED_ACR: "2",
    QCRM_OIDC_MAX_TOKEN_AGE_SECONDS: "300",
    QCRM_TENANT_CRM_WEB_EDGE_ALIAS: tenantEdgeServiceAlias(request.tenantProfileId, "crm-web"),
    QCRM_TENANT_PORTAL_WEB_EDGE_ALIAS: tenantEdgeServiceAlias(
      request.tenantProfileId,
      "portal-web",
    ),
    QCRM_TENANT_API_EDGE_ALIAS: tenantEdgeServiceAlias(request.tenantProfileId, "api"),
    QCRM_TENANT_BOOTSTRAP_API_ALIAS: tenantBootstrapApiAlias(request.tenantProfileId),
  };
  for (const service of tenantContainerServiceNames) {
    const artifact = tenantArtifactByService[service];
    const digest = artifacts.get(artifact);
    if (!digest) throw new ComposePolicyValidationError(`artifact.${service}`);
    environment[`QCRM_${artifact}_DIGEST`] = digest.slice("sha256:".length);
  }
  const migratorDigest = artifacts.get("CRM_MIGRATOR");
  if (!migratorDigest) throw new ComposePolicyValidationError("artifact.crm-migrator");
  environment.QCRM_CRM_MIGRATOR_DIGEST = migratorDigest.slice("sha256:".length);
  return Object.freeze({
    projectName: request.projectName,
    templatePath,
    services: Object.freeze([...tenantContainerServiceNames]),
    environment: Object.freeze(environment),
  });
}
