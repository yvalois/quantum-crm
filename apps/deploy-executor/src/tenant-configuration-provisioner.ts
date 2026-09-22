import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  tenantDatabaseIdentity,
  tenantDatabaseSecretKinds,
  tenantDatabaseSecretReference,
  tenantStorageBucketReference,
  tenantStorageSecretKinds,
  tenantStorageSecretReference,
  type TenantConfigurationProvisioner,
  type TenantConfigurationProvisioningCommand,
  type TenantConfigurationProvisioningResult,
  type PlatformRelease,
  type PlatformReleaseRepository,
} from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class TenantConfigurationProvisioningError extends Error {
  public constructor(
    public readonly reason:
      "UNAVAILABLE" | "PERMISSION_DENIED" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT",
  ) {
    super(`Tenant configuration provisioning failed: ${reason}`);
    this.name = "TenantConfigurationProvisioningError";
  }
}

export interface TenantConfigurationProvisionerOptions {
  readonly configurationDirectory: string;
  readonly storageEndpoint: string;
  readonly releaseRepository: Pick<PlatformReleaseRepository, "findById">;
}

function assertUuid(value: string): void {
  if (!uuidPattern.test(value)) {
    throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
  }
}

async function assertDirectory(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
    }
  } catch (error) {
    if (error instanceof TenantConfigurationProvisioningError) throw error;
    if ((error as { readonly code?: string }).code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
}

function manifestFor(
  command: TenantConfigurationProvisioningCommand,
  storageEndpoint: string,
  release: PlatformRelease,
): string {
  const database = tenantDatabaseIdentity(command.tenantProfileId);
  const databaseSecrets = tenantDatabaseSecretKinds.map((kind) =>
    tenantDatabaseSecretReference(command.tenantProfileId, kind),
  );
  const storageBuckets = [
    tenantStorageBucketReference(command.tenantProfileId, "INCOMING", command.quotaMiB),
    tenantStorageBucketReference(command.tenantProfileId, "OBJECTS", command.quotaMiB),
  ];
  const storageSecrets = tenantStorageSecretKinds.map((kind) =>
    tenantStorageSecretReference(command.tenantProfileId, kind),
  );
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      tenantProfileId: command.tenantProfileId,
      serverId: command.serverId,
      releaseId: command.releaseId,
      release: {
        id: release.id,
        version: release.version.toString(),
        artifacts: release.artifacts,
      },
      database: {
        databaseName: database.databaseName,
        migratorRoleName: database.migratorRoleName,
        runtimeRoleName: database.runtimeRoleName,
        secrets: databaseSecrets.map((secret) => ({
          kind: secret.kind,
          secretRef: secret.secretRef,
          version: secret.version.toString(),
        })),
      },
      storage: {
        endpoint: storageEndpoint,
        buckets: storageBuckets,
        secrets: storageSecrets.map((secret) => ({
          kind: secret.kind,
          secretRef: secret.secretRef,
          version: secret.version.toString(),
        })),
      },
    },
    null,
    2,
  )}\n`;
}

export function createTenantConfigurationProvisioner(
  options: TenantConfigurationProvisionerOptions,
): TenantConfigurationProvisioner {
  const provision = async (
    command: TenantConfigurationProvisioningCommand,
  ): Promise<TenantConfigurationProvisioningResult> => {
    assertUuid(command.tenantProfileId);
    assertUuid(command.serverId);
    assertUuid(command.releaseId);
    if (!Number.isInteger(command.quotaMiB) || command.quotaMiB < 1) {
      throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
    }
    let endpoint: URL;
    try {
      endpoint = new URL(options.storageEndpoint);
    } catch {
      throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
    }
    if (!["http:", "https:"].includes(endpoint.protocol)) {
      throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
    }
    const release = await options.releaseRepository.findById(command.releaseId);
    if (!release || release.status !== "VALIDATED" || release.id !== command.releaseId) {
      throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
    }

    const tenantDirectory = join(options.configurationDirectory, "tenant");
    const profileDirectory = join(tenantDirectory, command.tenantProfileId);
    const manifestRef = `tenant/${command.tenantProfileId}/configuration.json`;
    const manifestPath = join(profileDirectory, "configuration.json");
    const content = manifestFor(command, endpoint.toString().replace(/\/$/u, ""), release);
    try {
      await assertDirectory(options.configurationDirectory);
      await assertDirectory(tenantDirectory);
      await assertDirectory(profileDirectory);
      try {
        const currentStats = await lstat(manifestPath);
        if (!currentStats.isFile() || currentStats.isSymbolicLink()) {
          throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
        }
        const current = await readFile(manifestPath, "utf8");
        if (current !== content) {
          throw new TenantConfigurationProvisioningError("TARGET_CONFLICT");
        }
        return Object.freeze({ manifestRef, revision: 1n, reconciled: true });
      } catch (error) {
        if (error instanceof TenantConfigurationProvisioningError) throw error;
        if ((error as { readonly code?: string }).code !== "ENOENT") throw error;
      }
      const temporaryPath = join(
        profileDirectory,
        `.configuration.${process.pid}.${randomUUID()}.tmp`,
      );
      try {
        await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await chmod(temporaryPath, 0o600);
        await rename(temporaryPath, manifestPath);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
      return Object.freeze({ manifestRef, revision: 1n, reconciled: false });
    } catch (error) {
      if (error instanceof TenantConfigurationProvisioningError) throw error;
      const code = (error as { readonly code?: string }).code;
      if (code === "EACCES" || code === "EPERM") {
        throw new TenantConfigurationProvisioningError("PERMISSION_DENIED");
      }
      throw new TenantConfigurationProvisioningError("UNAVAILABLE");
    }
  };

  return Object.freeze({ provision });
}
