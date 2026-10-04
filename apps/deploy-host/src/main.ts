import { loadServiceConfig } from "@quantum-crm/config";

import {
  createCommandRunner,
  createTenantComposeReconciler,
  createTenantCrmMigrationReconciler,
} from "./compose-runner.js";
import { createTenantCaddyRouteReconciler } from "./caddy-route-runner.js";
import { createHostAdapterServer } from "./host-adapter.js";
import { createPlatformFoundationReleaseDeployer } from "./platform-foundation-release.js";

const config = loadServiceConfig("deploy-host");
if (!config.deployHostSocketPath) throw new Error("deploy-host socket configuration missing");
if (
  !config.deployHostConfigurationRoot ||
  !config.deployHostComposeTemplate ||
  !config.deployHostPlatformFoundationComposeTemplate ||
  !config.deployHostPlatformFoundationEnvironmentFile ||
  !config.deployHostPlatformComposeTemplate ||
  !config.deployHostPlatformEnvironmentFile ||
  !config.deployHostImageRegistry ||
  !config.deployHostTenantEdgeNetwork ||
  !config.deployHostPlatformDatabaseNetwork ||
  !config.deployHostPlatformStorageNetwork ||
  !config.deployHostPlatformSessionNetwork ||
  !config.deployHostPlatformOidcNetwork ||
  !config.deployHostDatabaseSecretRoot ||
  !config.deployHostTenantRouteRoot ||
  !config.deployHostStoragePublicEndpoint
) {
  throw new Error("deploy-host compose runtime configuration missing");
}

const reconciler = createTenantComposeReconciler({
  configurationRoot: config.deployHostConfigurationRoot,
  composeTemplate: config.deployHostComposeTemplate,
  imageRegistry: config.deployHostImageRegistry,
  environment:
    config.environment === "local" || config.environment === "test"
      ? "preview"
      : config.environment,
  tenantEdgeNetworkPrefix: config.deployHostTenantEdgeNetwork,
  platformDatabaseNetwork: config.deployHostPlatformDatabaseNetwork,
  platformStorageNetwork: config.deployHostPlatformStorageNetwork,
  platformSessionNetwork: config.deployHostPlatformSessionNetwork,
  platformOidcNetwork: config.deployHostPlatformOidcNetwork,
  databaseSecretRoot: config.deployHostDatabaseSecretRoot,
  storagePublicEndpoint: config.deployHostStoragePublicEndpoint,
});
const migrationReconciler = createTenantCrmMigrationReconciler({
  configurationRoot: config.deployHostConfigurationRoot,
  composeTemplate: config.deployHostComposeTemplate,
  imageRegistry: config.deployHostImageRegistry,
  environment:
    config.environment === "local" || config.environment === "test"
      ? "preview"
      : config.environment,
  tenantEdgeNetworkPrefix: config.deployHostTenantEdgeNetwork,
  platformDatabaseNetwork: config.deployHostPlatformDatabaseNetwork,
  platformStorageNetwork: config.deployHostPlatformStorageNetwork,
  platformSessionNetwork: config.deployHostPlatformSessionNetwork,
  platformOidcNetwork: config.deployHostPlatformOidcNetwork,
  databaseSecretRoot: config.deployHostDatabaseSecretRoot,
  storagePublicEndpoint: config.deployHostStoragePublicEndpoint,
});
const server = createHostAdapterServer({
  socketPath: config.deployHostSocketPath,
  requestTimeoutMilliseconds: 180_000,
  reconciler,
  migrationReconciler,
  foundationReleaseDeployer: createPlatformFoundationReleaseDeployer({
    composeTemplate: config.deployHostPlatformFoundationComposeTemplate,
    environmentFile: config.deployHostPlatformFoundationEnvironmentFile,
    platformComposeTemplate: config.deployHostPlatformComposeTemplate,
    platformEnvironmentFile: config.deployHostPlatformEnvironmentFile,
    imageRegistry: config.deployHostImageRegistry,
    baseEnvironment: { QCRM_ENV: config.environment },
    commandRunner: createCommandRunner("/usr/bin/docker"),
  }),
  httpsRouteReconciler: createTenantCaddyRouteReconciler({
    routeRoot: config.deployHostTenantRouteRoot,
  }),
});

await server.listen();
