import { loadServiceConfig } from "@quantum-crm/config";

import { createTenantComposeReconciler } from "./compose-runner.js";
import { createHostAdapterServer } from "./host-adapter.js";

const config = loadServiceConfig("deploy-host");
if (!config.deployHostSocketPath) throw new Error("deploy-host socket configuration missing");
if (
  !config.deployHostConfigurationRoot ||
  !config.deployHostComposeTemplate ||
  !config.deployHostImageRegistry ||
  !config.deployHostTenantEdgeNetwork ||
  !config.deployHostPlatformDatabaseNetwork ||
  !config.deployHostPlatformStorageNetwork ||
  !config.deployHostDatabaseSecretRoot
) {
  throw new Error("deploy-host compose runtime configuration missing");
}

const server = createHostAdapterServer({
  socketPath: config.deployHostSocketPath,
  reconciler: createTenantComposeReconciler({
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
    databaseSecretRoot: config.deployHostDatabaseSecretRoot,
  }),
});

await server.listen();
