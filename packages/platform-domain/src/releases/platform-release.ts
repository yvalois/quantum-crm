const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const semanticVersionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const contractVersionPattern = /^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/u;

export const platformReleaseStatuses = ["CANDIDATE", "VALIDATED", "RETIRED"] as const;
export type PlatformReleaseStatus = (typeof platformReleaseStatuses)[number];

export const platformReleaseArtifactNames = [
  "CRM_WEB",
  "PORTAL_WEB",
  "ADMIN_WEB",
  "API",
  "ADMIN_API",
  "WORKER",
  "DEPLOY_EXECUTOR",
  "CRM_MIGRATOR",
  "PLATFORM_KEYCLOAK",
  "AGENT_RUNTIME",
] as const;
export type PlatformReleaseArtifactName = (typeof platformReleaseArtifactNames)[number];

export const legacyPlatformReleaseArtifactNames = platformReleaseArtifactNames.filter(
  (name) => name !== "CRM_MIGRATOR" && name !== "PLATFORM_KEYCLOAK",
);

export interface PlatformReleaseArtifact {
  readonly name: PlatformReleaseArtifactName;
  readonly digest: string;
}

export interface PlatformReleaseCompatibility {
  readonly configurationSchemaVersion: number;
  readonly agentContractVersion: string;
  readonly databaseMigrationRequired: boolean;
  readonly minimumSourceVersion?: string;
}

export interface PlatformReleaseDraft {
  readonly id: string;
  readonly semanticVersion: string;
  readonly commitSha: string;
  readonly releaseNotes: string;
  readonly compatibility: PlatformReleaseCompatibility;
  readonly artifacts: readonly PlatformReleaseArtifact[];
}

export interface PlatformRelease extends PlatformReleaseDraft {
  readonly legacyArtifactCatalog: boolean;
  readonly status: PlatformReleaseStatus;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class PlatformReleaseValidationError extends Error {
  public constructor(field: string) {
    super(`Invalid platform release field: ${field}`);
    this.name = "PlatformReleaseValidationError";
  }
}

function semanticVersion(field: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length > 80 || !semanticVersionPattern.test(normalized)) {
    throw new PlatformReleaseValidationError(field);
  }
  return normalized;
}

function artifacts(
  input: readonly PlatformReleaseArtifact[],
  legacyArtifactCatalog = false,
): readonly PlatformReleaseArtifact[] {
  const expectedNames = legacyArtifactCatalog
    ? legacyPlatformReleaseArtifactNames
    : platformReleaseArtifactNames;
  if (input.length !== expectedNames.length) {
    throw new PlatformReleaseValidationError("artifacts");
  }
  const byName = new Map<PlatformReleaseArtifactName, string>();
  for (const artifact of input) {
    if (
      !platformReleaseArtifactNames.includes(artifact.name) ||
      !digestPattern.test(artifact.digest)
    ) {
      throw new PlatformReleaseValidationError("artifacts");
    }
    if (byName.has(artifact.name)) throw new PlatformReleaseValidationError("artifacts");
    byName.set(artifact.name, artifact.digest);
  }
  if (expectedNames.some((name) => !byName.has(name))) {
    throw new PlatformReleaseValidationError("artifacts");
  }
  return Object.freeze(
    expectedNames.map((name) =>
      Object.freeze({ name, digest: byName.get(name) as string }),
    ),
  );
}

function compatibility(input: PlatformReleaseCompatibility): PlatformReleaseCompatibility {
  if (
    !Number.isSafeInteger(input.configurationSchemaVersion) ||
    input.configurationSchemaVersion < 1
  ) {
    throw new PlatformReleaseValidationError("compatibility.configurationSchemaVersion");
  }
  const agentContractVersion = input.agentContractVersion.trim().toLowerCase();
  if (!contractVersionPattern.test(agentContractVersion)) {
    throw new PlatformReleaseValidationError("compatibility.agentContractVersion");
  }
  const minimumSourceVersion = input.minimumSourceVersion
    ? semanticVersion("compatibility.minimumSourceVersion", input.minimumSourceVersion)
    : undefined;
  if (!input.databaseMigrationRequired && minimumSourceVersion) {
    throw new PlatformReleaseValidationError("compatibility.minimumSourceVersion");
  }
  return Object.freeze({
    configurationSchemaVersion: input.configurationSchemaVersion,
    agentContractVersion,
    databaseMigrationRequired: input.databaseMigrationRequired,
    ...(minimumSourceVersion ? { minimumSourceVersion } : {}),
  });
}

export function createPlatformReleaseDraft(input: PlatformReleaseDraft): PlatformReleaseDraft {
  const id = input.id.trim().toLowerCase();
  if (!uuidPattern.test(id)) throw new PlatformReleaseValidationError("id");
  const commitSha = input.commitSha.trim().toLowerCase();
  if (!commitPattern.test(commitSha)) throw new PlatformReleaseValidationError("commitSha");
  const releaseNotes = input.releaseNotes.trim();
  if (releaseNotes.length === 0 || releaseNotes.length > 10_000) {
    throw new PlatformReleaseValidationError("releaseNotes");
  }
  return Object.freeze({
    id,
    semanticVersion: semanticVersion("semanticVersion", input.semanticVersion),
    commitSha,
    releaseNotes,
    compatibility: compatibility(input.compatibility),
    artifacts: artifacts(input.artifacts),
  });
}

export function hydratePlatformRelease(
  input: PlatformReleaseDraft & {
    readonly legacyArtifactCatalog?: boolean;
    readonly status: PlatformReleaseStatus;
    readonly version: bigint;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  },
): PlatformRelease {
  if (!platformReleaseStatuses.includes(input.status)) {
    throw new PlatformReleaseValidationError("status");
  }
  if (input.version < 1n) throw new PlatformReleaseValidationError("version");
  if (Number.isNaN(input.createdAt.getTime()))
    throw new PlatformReleaseValidationError("createdAt");
  if (Number.isNaN(input.updatedAt.getTime()) || input.updatedAt < input.createdAt) {
    throw new PlatformReleaseValidationError("updatedAt");
  }
  const legacyArtifactCatalog = input.legacyArtifactCatalog === true;
  const draft = legacyArtifactCatalog
    ? Object.freeze({
        id: input.id.trim().toLowerCase(),
        semanticVersion: semanticVersion("semanticVersion", input.semanticVersion),
        commitSha: input.commitSha.trim().toLowerCase(),
        releaseNotes: input.releaseNotes.trim(),
        compatibility: compatibility(input.compatibility),
        artifacts: artifacts(input.artifacts, true),
      })
    : createPlatformReleaseDraft(input);
  if (!uuidPattern.test(draft.id)) throw new PlatformReleaseValidationError("id");
  if (!commitPattern.test(draft.commitSha)) throw new PlatformReleaseValidationError("commitSha");
  if (draft.releaseNotes.length === 0 || draft.releaseNotes.length > 10_000) {
    throw new PlatformReleaseValidationError("releaseNotes");
  }
  return Object.freeze({
    ...draft,
    legacyArtifactCatalog,
    status: input.status,
    version: input.version,
    createdAt: new Date(input.createdAt.getTime()),
    updatedAt: new Date(input.updatedAt.getTime()),
  });
}

export function transitionPlatformReleaseStatus(
  current: PlatformReleaseStatus,
  target: PlatformReleaseStatus,
): PlatformReleaseStatus {
  if (
    (current === "CANDIDATE" && target === "VALIDATED") ||
    (current === "VALIDATED" && target === "RETIRED") ||
    current === target
  ) {
    return target;
  }
  throw new PlatformReleaseValidationError("status");
}
