import { chmod, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type { PlatformRelease, PlatformReleaseRepository } from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class TenantReleaseConfigurationProvisioningError extends Error {
  public constructor(public readonly reason: "UNAVAILABLE" | "PERMISSION_DENIED" | "TARGET_CONFLICT" | "IDENTITY_MISMATCH") {
    super(`tenant release configuration failed: ${reason}`);
    this.name = "TenantReleaseConfigurationProvisioningError";
  }
}

export interface TenantReleaseConfigurationProvisioner {
  readonly provision: (command: TenantReleaseConfigurationCommand) => Promise<{ readonly manifestRef: string; readonly revision: bigint }>;
}
export interface TenantReleaseConfigurationCommand {
    readonly tenantProfileId: string;
    readonly targetReleaseId: string;
    readonly expectedRevision: bigint;
}

function assertUuid(value: string): void {
  if (!uuidPattern.test(value)) throw new TenantReleaseConfigurationProvisioningError("IDENTITY_MISMATCH");
}

function releaseValue(release: PlatformRelease): Record<string, unknown> {
  return { id: release.id, version: release.version.toString(), artifacts: release.artifacts };
}

export function createTenantReleaseConfigurationProvisioner(options: {
  readonly configurationDirectory: string;
  readonly releaseRepository: Pick<PlatformReleaseRepository, "findById">;
}): TenantReleaseConfigurationProvisioner {
  return Object.freeze({
    provision: async (command: TenantReleaseConfigurationCommand) => {
      assertUuid(command.tenantProfileId);
      assertUuid(command.targetReleaseId);
      if (command.expectedRevision < 1n) throw new TenantReleaseConfigurationProvisioningError("IDENTITY_MISMATCH");
      const release = await options.releaseRepository.findById(command.targetReleaseId);
      if (!release || release.status !== "VALIDATED") throw new TenantReleaseConfigurationProvisioningError("IDENTITY_MISMATCH");
      const profileDirectory = join(options.configurationDirectory, "tenant", command.tenantProfileId);
      const manifestPath = join(profileDirectory, "configuration.json");
      const manifestRef = `tenant/${command.tenantProfileId}/configuration.json`;
      let current: Record<string, unknown>;
      try {
        const metadata = await lstat(manifestPath);
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TenantReleaseConfigurationProvisioningError("IDENTITY_MISMATCH");
        current = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      } catch (error) {
        if (error instanceof TenantReleaseConfigurationProvisioningError) throw error;
        if ((error as { readonly code?: string }).code === "ENOENT") throw new TenantReleaseConfigurationProvisioningError("UNAVAILABLE");
        throw new TenantReleaseConfigurationProvisioningError("IDENTITY_MISMATCH");
      }
      if (current.tenantProfileId !== command.tenantProfileId || typeof current.serverId !== "string" || !uuidPattern.test(current.serverId)) {
        throw new TenantReleaseConfigurationProvisioningError("IDENTITY_MISMATCH");
      }
      const currentRelease = current.release;
      if (typeof currentRelease !== "object" || currentRelease === null) throw new TenantReleaseConfigurationProvisioningError("IDENTITY_MISMATCH");
      const next = { ...current, releaseId: command.targetReleaseId, release: releaseValue(release) };
      const content = `${JSON.stringify(next, null, 2)}\n`;
      const previous = await readFile(manifestPath, "utf8");
      if (previous === content) return Object.freeze({ manifestRef, revision: command.expectedRevision });
      const temporaryPath = join(profileDirectory, `.configuration.${process.pid}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await chmod(temporaryPath, 0o600);
        await rename(temporaryPath, manifestPath);
      } catch (error) {
        const code = (error as { readonly code?: string }).code;
        throw new TenantReleaseConfigurationProvisioningError(code === "EACCES" || code === "EPERM" ? "PERMISSION_DENIED" : "UNAVAILABLE");
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
      return Object.freeze({ manifestRef, revision: command.expectedRevision });
    },
  });
}
