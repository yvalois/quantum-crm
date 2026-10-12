import { crmWebSessionPolicy, loadServiceConfig } from "@quantum-crm/config";

import { reconcileTenantAgentClients } from "./tenant-identity-provisioner.js";

async function reconcile(): Promise<void> {
  const [tenantProfileId] = process.argv.slice(2);
  if (!tenantProfileId || process.argv.length !== 3)
    throw new Error("A single tenant profile id is required");
  const config = loadServiceConfig("deploy-executor");
  if (!config.identityProvisioner || !config.tenantSecretDirectory)
    throw new Error("Identity provisioner configuration missing");
  await reconcileTenantAgentClients(
    {
      keycloakAdminOrigin: config.identityProvisioner.keycloakAdminOrigin,
      keycloakProvisionerClientId: config.identityProvisioner.keycloakProvisionerClientId,
      keycloakProvisionerClientSecret:
        config.identityProvisioner.keycloakProvisionerClientSecret.expose(),
      identityOrigin: config.identityProvisioner.identityOrigin,
      redisAdminUrl: config.identityProvisioner.redisAdminUrl.expose(),
      tenantSecretDirectory: config.tenantSecretDirectory,
      sessionPolicy: crmWebSessionPolicy,
    },
    tenantProfileId,
  );
  process.stdout.write("Agent service clients reconciled\n");
}

void reconcile().catch(() => {
  process.stderr.write("Agent service client reconciliation failed\n");
  process.exitCode = 1;
});
