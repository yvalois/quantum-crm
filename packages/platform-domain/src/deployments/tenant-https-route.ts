const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const hostnamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[0-9-]+\.nip\.io$/u;
const networkPrefixPattern = /^[a-z][a-z0-9-]{0,30}$/u;

export const tenantHttpsRouteStatuses = [
  "PENDING",
  "CONFIGURING",
  "CONFIGURED",
  "VERIFIED",
  "FAILED",
] as const;
export type TenantHttpsRouteStatus = (typeof tenantHttpsRouteStatuses)[number];

export const tenantHttpsUpstreamServiceNames = ["crm-web", "portal-web", "api"] as const;
export type TenantHttpsUpstreamServiceName = (typeof tenantHttpsUpstreamServiceNames)[number];

export interface TenantHttpsRouteIdentity {
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly hostname: string;
  readonly edgeNetworkName: string;
  readonly upstreamServices: readonly TenantHttpsUpstreamServiceName[];
}

export interface TenantHttpsRouteProvisioningCommand extends TenantHttpsRouteIdentity {
  readonly operationId: string;
  readonly releaseId: string;
  readonly configurationRevision: bigint;
  readonly attempt: number;
}

export interface TenantHttpsRouteProvisioningResult {
  readonly hostname: string;
  readonly edgeNetworkName: string;
  readonly routeGeneration: bigint;
  readonly configured: boolean;
  readonly reconciled: boolean;
}

export interface TenantHttpsRouteProvisioner {
  readonly provision: (
    command: TenantHttpsRouteProvisioningCommand,
  ) => Promise<TenantHttpsRouteProvisioningResult>;
}

export class TenantHttpsRouteValidationError extends Error {
  public constructor(field: string) {
    super(`Invalid tenant HTTPS route field: ${field}`);
    this.name = "TenantHttpsRouteValidationError";
  }
}

function uuid(field: string, value: string): string {
  const normalized = value.toLowerCase();
  if (!uuidPattern.test(normalized)) throw new TenantHttpsRouteValidationError(field);
  return normalized;
}

function ipv4(value: string): string {
  const octets = value.split(".");
  if (
    octets.length !== 4 ||
    octets.some((octet) => !/^[0-9]{1,3}$/u.test(octet) || Number(octet) > 255)
  ) {
    throw new TenantHttpsRouteValidationError("publicIpv4");
  }
  return octets.map((octet) => String(Number(octet))).join(".");
}

function slug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!slugPattern.test(normalized)) throw new TenantHttpsRouteValidationError("slug");
  return normalized;
}

export function tenantHttpsHostname(tenantSlug: string, publicIpv4: string): string {
  const normalizedSlug = slug(tenantSlug);
  const address = ipv4(publicIpv4).replaceAll(".", "-");
  return `${normalizedSlug}.${address}.nip.io`;
}

export function tenantHttpsEdgeNetworkName(
  tenantProfileId: string,
  prefix = "qcrm-tenant-edge",
): string {
  const normalized = uuid("tenantProfileId", tenantProfileId);
  if (!networkPrefixPattern.test(prefix)) {
    throw new TenantHttpsRouteValidationError("edgeNetworkPrefix");
  }
  return `${prefix}-${normalized}`;
}

export function validateTenantHttpsRouteProvisioningCommand(
  input: TenantHttpsRouteProvisioningCommand,
): TenantHttpsRouteProvisioningCommand {
  uuid("operationId", input.operationId);
  const tenantProfileId = uuid("tenantProfileId", input.tenantProfileId);
  uuid("serverId", input.serverId);
  uuid("releaseId", input.releaseId);
  if (!hostnamePattern.test(input.hostname)) {
    throw new TenantHttpsRouteValidationError("hostname");
  }
  if (input.edgeNetworkName !== tenantHttpsEdgeNetworkName(tenantProfileId)) {
    throw new TenantHttpsRouteValidationError("edgeNetworkName");
  }
  if (
    input.upstreamServices.length === 0 ||
    new Set(input.upstreamServices).size !== input.upstreamServices.length ||
    input.upstreamServices.some((service) => !tenantHttpsUpstreamServiceNames.includes(service))
  ) {
    throw new TenantHttpsRouteValidationError("upstreamServices");
  }
  if (input.configurationRevision < 1n) {
    throw new TenantHttpsRouteValidationError("configurationRevision");
  }
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new TenantHttpsRouteValidationError("attempt");
  }
  return Object.freeze({
    ...input,
    tenantProfileId,
    edgeNetworkName: input.edgeNetworkName,
    upstreamServices: Object.freeze([...input.upstreamServices].sort()),
  });
}
