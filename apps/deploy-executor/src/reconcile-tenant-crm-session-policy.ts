import { crmWebSessionPolicy, loadServiceConfig } from "@quantum-crm/config";

import { reconcileTenantCrmSessionPolicy } from "./tenant-identity-provisioner.js";

async function reconcile(): Promise<void> {
  const [tenantProfileId] = process.argv.slice(2);
  if (!tenantProfileId || process.argv.length !== 3) {
    throw new Error("A single tenant profile id is required");
  }
  const config = loadServiceConfig("deploy-executor");
  if (!config.identityProvisioner) {
    throw new Error("deploy-executor identity provisioner configuration missing");
  }
  await reconcileTenantCrmSessionPolicy(
    {
      keycloakAdminOrigin: config.identityProvisioner.keycloakAdminOrigin,
      keycloakProvisionerClientId: config.identityProvisioner.keycloakProvisionerClientId,
      keycloakProvisionerClientSecret:
        config.identityProvisioner.keycloakProvisionerClientSecret.expose(),
      sessionPolicy: crmWebSessionPolicy,
    },
    tenantProfileId,
  );
  process.stdout.write(`CRM session policy reconciled for ${tenantProfileId}\n`);
}

void reconcile().catch(() => {
  process.stderr.write("CRM session policy reconciliation failed\n");
  process.exitCode = 1;
});
