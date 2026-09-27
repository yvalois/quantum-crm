import {
  PlatformReleaseArtifactNames,
  platformFoundationDigestMapping,
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
  readonly imageRegistry: string;
  /** Existing foundation configuration (networks, secrets and other immutable images). */
  readonly baseEnvironment: Readonly<Record<string, string>>;
  readonly commandRunner: ComposeCommandRunner;
  readonly timeoutMilliseconds?: number;
}

/**
 * The only foundation image controlled by a platform release is Keycloak. This
 * deploy-host consumer derives its compose environment from the signed release
 * artifact rather than accepting a free-form digest from an operator.
 */
export function createPlatformFoundationReleaseDeployer(
  options: PlatformFoundationReleaseDeployerOptions,
) {
  if (
    !options.composeTemplate.startsWith("/") ||
    !options.environmentFile.startsWith("/") ||
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
      const result = await options.commandRunner.run(
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
      if (result.exitCode !== 0) throw new HostAdapterError("UNAVAILABLE");
    },
  });
}
