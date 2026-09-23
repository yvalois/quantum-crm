import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { SecretFileSystem } from "./secret-value.js";
import { parseWebAuthConfig, type WebAuthConfig } from "./web-auth-config.js";

export const crmWebOidcClientSecretPath = "/run/secrets/qcrm_oidc_client_secret";
export const crmWebSessionRedisUrlPath = "/run/secrets/qcrm_session_redis_url";

export interface CrmWebAuthConfig extends WebAuthConfig {
  readonly schemaVersion: "crm-web-auth-config/v1";
  readonly crmApiOrigin: string;
  readonly tenantId: string;
}

export function parseCrmWebAuthConfig(
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): CrmWebAuthConfig {
  const tenantId = z.string().uuid().safeParse(environment.QCRM_TENANT_ID);
  if (!tenantId.success) {
    throw new ConfigurationError("crm-web", ["QCRM_TENANT_ID"]);
  }
  const { apiOrigin, ...config } = parseWebAuthConfig(
    environment,
    {
      application: "crm-web",
      originEnvironmentKey: "QCRM_CRM_WEB_ORIGIN",
      apiOriginEnvironmentKey: "QCRM_CRM_API_ORIGIN",
      clientSecretPath: crmWebOidcClientSecretPath,
      redisUrlPath: crmWebSessionRedisUrlPath,
      sessionNamespace: `crm:${tenantId.data}`,
    },
    fileSystem,
  );
  return Object.freeze({
    ...config,
    schemaVersion: "crm-web-auth-config/v1",
    crmApiOrigin: apiOrigin,
    tenantId: tenantId.data,
  });
}

export function loadCrmWebAuthConfig(): CrmWebAuthConfig {
  return parseCrmWebAuthConfig(process.env);
}
