import {
  PlatformReleaseArtifactNames,
  platformFoundationDigestMapping,
  platformServiceDigestMapping,
  type PlatformReleaseArtifactName,
} from "@quantum-crm/contracts";

import type { ComposeCommandRunner } from "./compose-runner.js";
import { HostAdapterError } from "./host-adapter.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const registryPattern = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,254}$/u;

export interface PlatformFoundationReleaseCommand {
  readonly artifacts: readonly {
    readonly name: PlatformReleaseArtifactName;
    readonly digest: string;
  }[];
}

export interface PlatformFoundationReleaseDeployerOptions {
  readonly composeTemplate: string;
  /** Host-controlled compose env file with the foundation's immutable settings. */
  readonly environmentFile: string;
  /** Optional host-controlled platform compose and env file. */
  readonly platformComposeTemplate?: string;
  readonly platformEnvironmentFile?: string;
  readonly imageRegistry: string;
  /** Existing foundation configuration (networks, secrets and other immutable images). */
  readonly baseEnvironment: Readonly<Record<string, string>>;
  readonly commandRunner: ComposeCommandRunner;
  readonly timeoutMilliseconds?: number;
}

/**
 * The deploy-host consumer derives both compose environments from the complete
 * release catalog rather than accepting free-form digests from an operator.
 * Foundation state is reconciled first, followed by the stateless platform
 * services when their host-controlled compose paths are configured.
 */
export function createPlatformFoundationReleaseDeployer(
  options: PlatformFoundationReleaseDeployerOptions,
) {
  if (
    !options.composeTemplate.startsWith("/") ||
    !options.environmentFile.startsWith("/") ||
    (options.platformComposeTemplate !== undefined &&
      !options.platformComposeTemplate.startsWith("/")) ||
    (options.platformEnvironmentFile !== undefined &&
      !options.platformEnvironmentFile.startsWith("/")) ||
    (options.platformComposeTemplate === undefined) !==
      (options.platformEnvironmentFile === undefined) ||
    !registryPattern.test(options.imageRegistry)
  ) {
    throw new Error("invalid platform foundation deployment configuration");
  }
  const timeout = options.timeoutMilliseconds ?? 120_000;
  return Object.freeze({
    deploy: async (command: PlatformFoundationReleaseCommand): Promise<void> => {
      if (
        command.artifacts.length !== PlatformReleaseArtifactNames.length ||
        new Set(command.artifacts.map((artifact) => artifact.name)).size !==
          PlatformReleaseArtifactNames.length ||
        PlatformReleaseArtifactNames.some(
          (name) => !command.artifacts.some((artifact) => artifact.name === name),
        ) ||
        command.artifacts.some((artifact) => !digestPattern.test(artifact.digest))
      ) {
        throw new HostAdapterError("IDENTITY_MISMATCH");
      }
      const mapping = platformFoundationDigestMapping(command.artifacts);
      const foundationResult = await options.commandRunner.run(
        [
          "compose",
          "--env-file",
          options.environmentFile,
          "-f",
          options.composeTemplate,
          "--project-name",
          "quantum-platform-foundation",
          "up",
          "-d",
          "--remove-orphans",
          "platform-keycloak",
        ],
        Object.freeze({
          ...options.baseEnvironment,
          QCRM_FOUNDATION_IMAGE_REGISTRY: options.imageRegistry,
          ...mapping,
        }),
        timeout,
      );
      if (foundationResult.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
      if (options.platformComposeTemplate && options.platformEnvironmentFile) {
        const platformEnvironment = Object.freeze({
          ...options.baseEnvironment,
          QCRM_IMAGE_REGISTRY: options.imageRegistry,
          ...platformServiceDigestMapping(command.artifacts),
        });
        const config = await options.commandRunner.run(
          [
            "compose",
            "--env-file",
            options.platformEnvironmentFile,
            "-f",
            options.platformComposeTemplate,
            "--project-name",
            "quantum-platform",
            "config",
            "--quiet",
          ],
          platformEnvironment,
          timeout,
        );
        if (config.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
        const up = await options.commandRunner.run(
          [
            "compose",
            "--env-file",
            options.platformEnvironmentFile,
            "-f",
            options.platformComposeTemplate,
            "--project-name",
            "quantum-platform",
            "up",
            "-d",
            "--remove-orphans",
            "admin-web",
            "admin-api",
            "deploy-executor",
          ],
          platformEnvironment,
          timeout,
        );
        if (up.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
        const observed = await options.commandRunner.run(
          [
            "compose",
            "--env-file",
            options.platformEnvironmentFile,
            "-f",
            options.platformComposeTemplate,
            "--project-name",
            "quantum-platform",
            "ps",
            "--format",
            "json",
          ],
          platformEnvironment,
          timeout,
        );
        if (observed.exitCode !== 0 || !platformServicesHealthy(observed.stdout)) {
          throw new HostAdapterError("UNAVAILABLE");
        }
      }
    },
  });
}

function platformServicesHealthy(stdout: string): boolean {
  try {
    const entries = JSON.parse(stdout) as unknown;
    if (!Array.isArray(entries)) return false;
    return ["admin-web", "admin-api", "deploy-executor"].every((service) =>
      entries.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { readonly Service?: unknown }).Service === service &&
          (entry as { readonly State?: unknown }).State === "running" &&
          (entry as { readonly Health?: unknown }).Health === "healthy",
      ),
    );
  } catch {
    return false;
  }
}
