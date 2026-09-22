import { describe, expect, it } from "vitest";

import { platformReleaseArtifactNames } from "@quantum-crm/platform-domain";

import {
  ComposePolicyValidationError,
  createTenantComposePlan,
  parseTenantConfigurationManifest,
} from "./compose-policy.js";

const request = {
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  projectName: "qcrm-t-01995f7e-7b52-7000-8000-000000000201",
} as const;

const manifest = {
  schemaVersion: 1,
  tenantProfileId: request.tenantProfileId,
  serverId: request.serverId,
  releaseId: request.releaseId,
  release: {
    id: request.releaseId,
    version: "1",
    artifacts: platformReleaseArtifactNames.map((name, index) => ({
      name,
      digest: `sha256:${index.toString(16).padStart(64, "0")}`,
    })),
  },
};

describe("tenant compose policy", () => {
  it("derives a fixed template plan and tenant image digests", () => {
    const parsed = parseTenantConfigurationManifest(manifest, request);
    const plan = createTenantComposePlan(request, parsed, {
      templatePath: "/opt/quantum/infra/compose/tenant.yaml",
      imageRegistry: "ghcr.io/example/quantum-crm",
      environment: "staging",
      tenantEdgeNetwork: "qcrm-tenant-edge",
      platformDatabaseNetwork: "qcrm-platform-database",
      platformStorageNetwork: "qcrm-platform-storage",
      crmDatabaseSecretFile: "/opt/quantum/secrets/tenant/runtime-url",
    });

    expect(plan.projectName).toBe(request.projectName);
    expect(plan.services).toEqual(["crm-web", "portal-web", "api", "worker", "agent-runtime"]);
    expect(plan.environment.QCRM_CRM_WEB_DIGEST).toHaveLength(64);
    expect(plan.environment.QCRM_AGENT_RUNTIME_DIGEST).toHaveLength(64);
  });

  it("rejects a release that omits an artifact or changes identity", () => {
    expect(() =>
      parseTenantConfigurationManifest(
        {
          ...manifest,
          tenantProfileId: "01995f7e-7b52-7000-8000-000000000202",
        },
        request,
      ),
    ).toThrow(new ComposePolicyValidationError("identity"));

    expect(() =>
      parseTenantConfigurationManifest(
        {
          ...manifest,
          release: {
            ...manifest.release,
            artifacts: manifest.release.artifacts.slice(0, -1),
          },
        },
        request,
      ),
    ).toThrow(new ComposePolicyValidationError("release.artifacts"));
  });

  it("rejects relative template paths", () => {
    const parsed = parseTenantConfigurationManifest(manifest, request);
    expect(() =>
      createTenantComposePlan(request, parsed, {
        templatePath: "/tmp/tenant.yaml",
        imageRegistry: "ghcr.io/example/quantum-crm",
        environment: "staging",
        tenantEdgeNetwork: "qcrm-tenant-edge",
        platformDatabaseNetwork: "qcrm-platform-database",
        platformStorageNetwork: "qcrm-platform-storage",
        crmDatabaseSecretFile: "/opt/quantum/secrets/tenant/runtime-url",
      }),
    ).not.toThrow();
    expect(() =>
      createTenantComposePlan(request, parsed, {
        templatePath: "../../tenant.yaml",
        imageRegistry: "ghcr.io/example/quantum-crm",
        environment: "staging",
        tenantEdgeNetwork: "qcrm-tenant-edge",
        platformDatabaseNetwork: "qcrm-platform-database",
        platformStorageNetwork: "qcrm-platform-storage",
        crmDatabaseSecretFile: "/opt/quantum/secrets/tenant/runtime-url",
      }),
    ).toThrow(new ComposePolicyValidationError("templatePath"));
  });
});
