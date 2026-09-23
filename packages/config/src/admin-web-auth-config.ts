import type { SecretFileSystem } from "./secret-value.js";
import { parseWebAuthConfig, type WebAuthConfig } from "./web-auth-config.js";

export const adminWebOidcClientSecretPath = "/run/secrets/qcrm_oidc_client_secret";
export const adminWebSessionRedisUrlPath = "/run/secrets/qcrm_session_redis_url";

export interface AdminWebAuthConfig extends WebAuthConfig {
  readonly schemaVersion: "admin-web-auth-config/v1";
  readonly adminApiOrigin: string;
  readonly sessionNamespace: "platform";
}

export function parseAdminWebAuthConfig(
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): AdminWebAuthConfig {
  const { apiOrigin, ...config } = parseWebAuthConfig(
    environment,
    {
      application: "admin-web",
      originEnvironmentKey: "QCRM_ADMIN_WEB_ORIGIN",
      apiOriginEnvironmentKey: "QCRM_ADMIN_API_ORIGIN",
      clientSecretPath: adminWebOidcClientSecretPath,
      redisUrlPath: adminWebSessionRedisUrlPath,
      sessionNamespace: "platform",
    },
    fileSystem,
  );
  return Object.freeze({
    ...config,
    schemaVersion: "admin-web-auth-config/v1",
    adminApiOrigin: apiOrigin,
    sessionNamespace: "platform",
  });
}

export function loadAdminWebAuthConfig(): AdminWebAuthConfig {
  return parseAdminWebAuthConfig(process.env);
}
