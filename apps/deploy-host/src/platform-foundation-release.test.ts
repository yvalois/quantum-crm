import { describe, expect, it, vi } from "vitest";

import { createPlatformFoundationReleaseDeployer } from "./platform-foundation-release.js";

describe("platform foundation release deployer", () => {
  it("derives Keycloak's compose digest only from PLATFORM_KEYCLOAK", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const deployer = createPlatformFoundationReleaseDeployer({
      composeTemplate: "/opt/quantum/infra/compose/platform-foundation.yaml",
      environmentFile: "/etc/quantum/platform-foundation.env",
      imageRegistry: "ghcr.io/example/quantum-crm",
      baseEnvironment: {},
      commandRunner: { run },
    });
    await deployer.deploy({
      artifacts: [
        { name: "CRM_WEB", digest: `sha256:${"0".repeat(64)}` },
        { name: "PORTAL_WEB", digest: `sha256:${"1".repeat(64)}` },
        { name: "ADMIN_WEB", digest: `sha256:${"2".repeat(64)}` },
        { name: "API", digest: `sha256:${"3".repeat(64)}` },
        { name: "ADMIN_API", digest: `sha256:${"4".repeat(64)}` },
        { name: "WORKER", digest: `sha256:${"5".repeat(64)}` },
        { name: "DEPLOY_EXECUTOR", digest: `sha256:${"6".repeat(64)}` },
        { name: "CRM_MIGRATOR", digest: `sha256:${"7".repeat(64)}` },
        { name: "PLATFORM_KEYCLOAK", digest: `sha256:${"a".repeat(64)}` },
        { name: "AGENT_RUNTIME", digest: `sha256:${"9".repeat(64)}` },
      ],
    });
    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--env-file",
        "/etc/quantum/platform-foundation.env",
        "platform-keycloak",
      ]),
      expect.objectContaining({ QCRM_PLATFORM_KEYCLOAK_IMAGE_DIGEST: "a".repeat(64) }),
      expect.any(Number),
    );
  });
});
