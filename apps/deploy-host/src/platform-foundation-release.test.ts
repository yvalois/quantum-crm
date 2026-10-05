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
        "--no-deps",
        "platform-keycloak",
      ]),
      expect.objectContaining({ QCRM_PLATFORM_KEYCLOAK_IMAGE_DIGEST: "a".repeat(64) }),
      expect.any(Number),
    );
  });

  it("reconciles the platform services from the three closed service digests", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: [
          { Service: "admin-web", State: "running", Health: "healthy" },
          { Service: "admin-api", State: "running", Health: "healthy" },
          { Service: "deploy-executor", State: "running", Health: "healthy" },
        ]
          .map((entry) => JSON.stringify(entry))
          .join("\n"),
        stderr: "",
      });
    const deployer = createPlatformFoundationReleaseDeployer({
      composeTemplate: "/opt/quantum/infra/compose/platform-foundation.yaml",
      environmentFile: "/etc/quantum/platform-foundation.env",
      platformComposeTemplate: "/opt/quantum/infra/compose/platform.yaml",
      platformEnvironmentFile: "/etc/quantum/platform.env",
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
      expect.arrayContaining(["--project-name", "quantum-platform", "config", "--quiet"]),
      expect.objectContaining({
        QCRM_ADMIN_WEB_DIGEST: "2".repeat(64),
        QCRM_ADMIN_API_DIGEST: "4".repeat(64),
        QCRM_DEPLOY_EXECUTOR_DIGEST: "6".repeat(64),
      }),
      expect.any(Number),
    );
    expect(run).toHaveBeenCalledWith(
      expect.arrayContaining([
        "--project-name",
        "quantum-platform",
        "up",
        "--wait",
        "--wait-timeout",
        "120",
      ]),
      expect.objectContaining({
        QCRM_ADMIN_WEB_DIGEST: "2".repeat(64),
        QCRM_ADMIN_API_DIGEST: "4".repeat(64),
        QCRM_DEPLOY_EXECUTOR_DIGEST: "6".repeat(64),
      }),
      expect.any(Number),
    );
  });
});
