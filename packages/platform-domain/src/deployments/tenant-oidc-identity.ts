const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface TenantOidcIdentity {
  readonly tenantProfileId: string;
  readonly realmName: string;
  readonly crmWebClientId: "quantum-crm-web";
  readonly apiAudience: "quantum-crm-api";
  readonly clientSecretRef: string;
  readonly sessionRedisUrlSecretRef: string;
}

export interface TenantIdentityProvisioningCommand {
  readonly tenantProfileId: string;
  readonly serverId: string;
  readonly hostname: string;
}

export interface TenantIdentityProvisioningResult {
  readonly identity: TenantOidcIdentity;
  readonly reconciled: boolean;
}

export interface TenantIdentityProvisioner {
  readonly provision: (
    command: TenantIdentityProvisioningCommand,
  ) => Promise<TenantIdentityProvisioningResult>;
}

export class TenantOidcIdentityValidationError extends Error {
  public constructor(field: string) {
    super(`Invalid tenant OIDC identity field: ${field}`);
    this.name = "TenantOidcIdentityValidationError";
  }
}

export function tenantOidcIdentity(tenantProfileId: string): TenantOidcIdentity {
  const normalized = normalizeUuid("tenantProfileId", tenantProfileId);
  const compact = normalized.replaceAll("-", "");
  return Object.freeze({
    tenantProfileId: normalized,
    realmName: `qcrm-${compact}`,
    crmWebClientId: "quantum-crm-web" as const,
    apiAudience: "quantum-crm-api" as const,
    clientSecretRef: `tenant/${normalized}/oidc-client-secret`,
    sessionRedisUrlSecretRef: `tenant/${normalized}/session-redis-url`,
  });
}

function normalizeUuid(field: string, value: string): string {
  const normalized = value.toLowerCase();
  if (!uuidPattern.test(normalized)) {
    throw new TenantOidcIdentityValidationError(field);
  }
  return normalized;
}
