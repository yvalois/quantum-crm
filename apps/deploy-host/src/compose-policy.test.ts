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
  storage: {
    endpoint: "http://platform-storage:8333",
    buckets: [
      {
        kind: "INCOMING",
        bucketName: "qcrm-01995f7e7b5270008000000000000201-incoming",
        quotaMiB: 10240,
        versioning: "ENABLED",
      },
      {
        kind: "OBJECTS",
        bucketName: "qcrm-01995f7e7b5270008000000000000201-objects",
        quotaMiB: 10240,
        versioning: "ENABLED",
      },
    ],
    secrets: [
      {
        kind: "ACCESS_KEY",
        secretRef: "tenant/01995f7e-7b52-7000-8000-000000000201/storage-access-key",
        version: "1",
      },
      {
        kind: "SECRET_KEY",
        secretRef: "tenant/01995f7e-7b52-7000-8000-000000000201/storage-secret-key",
        version: "1",
      },
    ],
  },
  identity: {
    crmWebOrigin: "https://acme.2-25-172-119.nip.io",
    issuer: "https://identity.example.test/realms/qcrm-01995f7e7b5270008000000000000201",
    crmWebClientId: "quantum-crm-web",
    apiAudience: "quantum-crm-api",
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
      platformSessionNetwork: "qcrm-platform-session",
      platformOidcNetwork: "qcrm-platform-oidc",
      storagePublicEndpoint: "https://files.example.test",
      storageSecretRoot: "/opt/quantum/secrets",
      crmDatabaseSecretFile: "/opt/quantum/secrets/tenant/runtime-url",
      crmMigrationDatabaseSecretFile: "/opt/quantum/secrets/tenant/migrator-url",
      crmOidcClientSecretFile: "/opt/quantum/secrets/tenant/oidc-client-secret",
      crmSessionRedisUrlSecretFile: "/opt/quantum/secrets/tenant/session-redis-url",
      iamBootstrapClientSecretFile: "/opt/quantum/secrets/tenant/iam-bootstrap-client-secret",
    });

    expect(plan.projectName).toBe(request.projectName);
    expect(plan.services).toEqual(["crm-web", "portal-web", "api", "worker", "agent-runtime"]);
    expect(plan.environment.QCRM_CRM_WEB_DIGEST).toHaveLength(64);
    expect(plan.environment.QCRM_AGENT_RUNTIME_DIGEST).toHaveLength(64);
    expect(plan.environment).toMatchObject({
      QCRM_FILES_S3_PUBLIC_ENDPOINT: "https://files.example.test",
      QCRM_FILES_INCOMING_BUCKET: "qcrm-01995f7e7b5270008000000000000201-incoming",
      QCRM_FILES_OBJECTS_BUCKET: "qcrm-01995f7e7b5270008000000000000201-objects",
      QCRM_FILES_S3_UPLOAD_ACCESS_KEY_SECRET_FILE:
        "/opt/quantum/secrets/tenant/01995f7e-7b52-7000-8000-000000000201/storage-access-key",
      QCRM_FILES_S3_UPLOAD_SECRET_KEY_SECRET_FILE:
        "/opt/quantum/secrets/tenant/01995f7e-7b52-7000-8000-000000000201/storage-secret-key",
      QCRM_FILES_S3_DELIVERY_ACCESS_KEY_SECRET_FILE:
        "/opt/quantum/secrets/tenant/01995f7e-7b52-7000-8000-000000000201/storage-access-key",
      QCRM_FILES_S3_DELIVERY_SECRET_KEY_SECRET_FILE:
        "/opt/quantum/secrets/tenant/01995f7e-7b52-7000-8000-000000000201/storage-secret-key",
      QCRM_FILES_S3_PROCESSOR_ACCESS_KEY_SECRET_FILE:
        "/opt/quantum/secrets/tenant/01995f7e-7b52-7000-8000-000000000201/storage-access-key",
      QCRM_FILES_S3_PROCESSOR_SECRET_KEY_SECRET_FILE:
        "/opt/quantum/secrets/tenant/01995f7e-7b52-7000-8000-000000000201/storage-secret-key",
    });
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
        platformSessionNetwork: "qcrm-platform-session",
        platformOidcNetwork: "qcrm-platform-oidc",
        storagePublicEndpoint: "https://files.example.test",
        storageSecretRoot: "/opt/quantum/secrets",
        crmDatabaseSecretFile: "/opt/quantum/secrets/tenant/runtime-url",
        crmMigrationDatabaseSecretFile: "/opt/quantum/secrets/tenant/migrator-url",
        crmOidcClientSecretFile: "/opt/quantum/secrets/tenant/oidc-client-secret",
        crmSessionRedisUrlSecretFile: "/opt/quantum/secrets/tenant/session-redis-url",
        iamBootstrapClientSecretFile: "/opt/quantum/secrets/tenant/iam-bootstrap-client-secret",
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
        platformSessionNetwork: "qcrm-platform-session",
        platformOidcNetwork: "qcrm-platform-oidc",
        storagePublicEndpoint: "https://files.example.test",
        storageSecretRoot: "/opt/quantum/secrets",
        crmDatabaseSecretFile: "/opt/quantum/secrets/tenant/runtime-url",
        crmMigrationDatabaseSecretFile: "/opt/quantum/secrets/tenant/migrator-url",
        crmOidcClientSecretFile: "/opt/quantum/secrets/tenant/oidc-client-secret",
        crmSessionRedisUrlSecretFile: "/opt/quantum/secrets/tenant/session-redis-url",
        iamBootstrapClientSecretFile: "/opt/quantum/secrets/tenant/iam-bootstrap-client-secret",
      }),
    ).toThrow(new ComposePolicyValidationError("templatePath"));
  });

  it("rejects tenant storage references that do not belong to the profile", () => {
    expect(() =>
      parseTenantConfigurationManifest(
        {
          ...manifest,
          storage: {
            ...manifest.storage,
            secrets: manifest.storage.secrets.map((secret) =>
              secret.kind === "ACCESS_KEY"
                ? { ...secret, secretRef: "tenant/other/storage-access-key" }
                : secret,
            ),
          },
        },
        request,
      ),
    ).toThrow(new ComposePolicyValidationError("storage.secrets"));
  });
});
