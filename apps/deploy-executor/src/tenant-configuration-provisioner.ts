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
  tenantOidcIdentity,
  type TenantConfigurationProvisioner,
  type TenantConfigurationProvisioningCommand,
  type TenantConfigurationProvisioningResult,
  type PlatformRelease,
  type PlatformReleaseRepository,
} from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hostnamePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[0-9-]+\.nip\.io$/u;

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
  readonly tenantSecretDirectory?: string;
  readonly databaseHost?: string;
  readonly databasePort?: number;
  readonly identityIssuer?: string;
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

async function ensureDatabaseUrl(
  rootDirectory: string,
  tenantProfileId: string,
  databaseName: string,
  roleName: string,
  databaseHost: string,
  databasePort: number,
  secretName: "runtime" | "migrator",
): Promise<void> {
  const directory = join(rootDirectory, tenantProfileId);
  const passwordPath = join(directory, `${secretName}-password`);
  const urlPath = join(directory, `${secretName}-url`);
  const passwordMetadata = await lstat(passwordPath);
  if (!passwordMetadata.isFile() || passwordMetadata.isSymbolicLink()) {
    throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
  }
  const password = (await readFile(passwordPath, "utf8")).trim();
  if (!password || /[\0\r\n]/u.test(password)) {
    throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
  }
  const url = new URL("postgresql://localhost");
  url.username = roleName;
  url.password = password;
  url.hostname = databaseHost;
  url.port = String(databasePort);
  url.pathname = `/${databaseName}`;
  const content = `${url.toString()}\n`;
  try {
    const metadata = await lstat(urlPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
    }
    if ((await readFile(urlPath, "utf8")) !== content) {
      throw new TenantConfigurationProvisioningError("TARGET_CONFLICT");
    }
    await chmod(urlPath, 0o400);
    return;
  } catch (error) {
    if (error instanceof TenantConfigurationProvisioningError) throw error;
    if ((error as { readonly code?: string }).code !== "ENOENT") throw error;
  }
  const temporaryPath = join(directory, `.${secretName}-url.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o400, flag: "wx" });
    await chmod(temporaryPath, 0o400);
    await rename(temporaryPath, urlPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function manifestFor(
  command: TenantConfigurationProvisioningCommand,
  storageEndpoint: string,
  release: PlatformRelease,
  identityIssuer: string,
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
  const expectedIdentity = tenantOidcIdentity(command.tenantProfileId);
  if (
    command.identity.realmName !== expectedIdentity.realmName ||
    command.identity.crmWebClientId !== expectedIdentity.crmWebClientId ||
    command.identity.apiAudience !== expectedIdentity.apiAudience ||
    command.identity.bootstrapClientId !== expectedIdentity.bootstrapClientId ||
    command.identity.bootstrapClientSecretRef !== expectedIdentity.bootstrapClientSecretRef ||
    command.identity.clientSecretRef !== expectedIdentity.clientSecretRef ||
    command.identity.sessionRedisUrlSecretRef !== expectedIdentity.sessionRedisUrlSecretRef
  ) {
    throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
  }
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
      identity: {
        crmWebOrigin: `https://${command.hostname}`,
        issuer: `${identityIssuer}/realms/${command.identity.realmName}`,
        crmWebClientId: command.identity.crmWebClientId,
        apiAudience: command.identity.apiAudience,
        bootstrapClientId: command.identity.bootstrapClientId,
        bootstrapClientSecretRef: command.identity.bootstrapClientSecretRef,
        clientSecretRef: command.identity.clientSecretRef,
        sessionRedisUrlSecretRef: command.identity.sessionRedisUrlSecretRef,
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
    if (!hostnamePattern.test(command.hostname)) {
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
    const database = tenantDatabaseIdentity(command.tenantProfileId);
    let identityIssuer: URL;
    try {
      identityIssuer = new URL(options.identityIssuer ?? "");
      if (
        identityIssuer.protocol !== "https:" ||
        identityIssuer.username ||
        identityIssuer.password ||
        identityIssuer.pathname !== "/" ||
        identityIssuer.search ||
        identityIssuer.hash
      ) {
        throw new Error("invalid identity issuer");
      }
    } catch {
      throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
    }
    if (options.tenantSecretDirectory) {
      const databaseHost = options.databaseHost ?? "platform-postgres";
      const databasePort = options.databasePort ?? 5432;
      if (
        !databaseHost ||
        /[\0\r\n]/u.test(databaseHost) ||
        !Number.isInteger(databasePort) ||
        databasePort < 1 ||
        databasePort > 65_535
      ) {
        throw new TenantConfigurationProvisioningError("IDENTITY_MISMATCH");
      }
      try {
        await ensureDatabaseUrl(
          options.tenantSecretDirectory,
          command.tenantProfileId,
          database.databaseName,
          database.runtimeRoleName,
          databaseHost,
          databasePort,
          "runtime",
        );
        await ensureDatabaseUrl(
          options.tenantSecretDirectory,
          command.tenantProfileId,
          database.databaseName,
          database.migratorRoleName,
          databaseHost,
          databasePort,
          "migrator",
        );
      } catch (error) {
        if (error instanceof TenantConfigurationProvisioningError) throw error;
        const code = (error as { readonly code?: string }).code;
        if (code === "ENOENT") throw new TenantConfigurationProvisioningError("UNAVAILABLE");
        if (code === "EACCES" || code === "EPERM") {
          throw new TenantConfigurationProvisioningError("PERMISSION_DENIED");
        }
        throw new TenantConfigurationProvisioningError("UNAVAILABLE");
      }
    }

    const tenantDirectory = join(options.configurationDirectory, "tenant");
    const profileDirectory = join(tenantDirectory, command.tenantProfileId);
    const manifestRef = `tenant/${command.tenantProfileId}/configuration.json`;
    const manifestPath = join(profileDirectory, "configuration.json");
    const content = manifestFor(
      command,
      endpoint.toString().replace(/\/$/u, ""),
      release,
      identityIssuer.origin,
    );
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
