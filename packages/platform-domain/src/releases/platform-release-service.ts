import {
  createPlatformReleaseDraft,
  type PlatformRelease,
  type PlatformReleaseDraft,
  type PlatformReleaseStatus,
  transitionPlatformReleaseStatus,
} from "./platform-release.js";

export interface PlatformReleaseListCriteria {
  readonly status?: PlatformReleaseStatus;
  readonly limit: number;
}

export interface PlatformReleaseRepository {
  readonly create: (draft: PlatformReleaseDraft) => Promise<PlatformRelease>;
  readonly findById: (id: string) => Promise<PlatformRelease | null>;
  readonly list: (criteria: PlatformReleaseListCriteria) => Promise<readonly PlatformRelease[]>;
  readonly updateStatus: (
    id: string,
    expectedVersion: bigint,
    status: PlatformReleaseStatus,
  ) => Promise<PlatformRelease | null>;
}

export class PlatformReleaseNotFoundError extends Error {
  public constructor() {
    super("Platform release not found");
    this.name = "PlatformReleaseNotFoundError";
  }
}

export class PlatformReleaseConflictError extends Error {
  public constructor() {
    super("Platform release conflicts with existing state");
    this.name = "PlatformReleaseConflictError";
  }
}

export class PlatformReleaseVersionConflictError extends Error {
  public constructor() {
    super("Platform release version is stale");
    this.name = "PlatformReleaseVersionConflictError";
  }
}

export class PlatformReleaseNotDeployableError extends Error {
  public constructor() {
    super("Platform release is not validated for deployment");
    this.name = "PlatformReleaseNotDeployableError";
  }
}

export class PlatformReleaseService {
  public constructor(private readonly repository: PlatformReleaseRepository) {}

  public create(command: PlatformReleaseDraft): Promise<PlatformRelease> {
    return this.repository.create(createPlatformReleaseDraft(command));
  }

  public async get(id: string): Promise<PlatformRelease> {
    const release = await this.repository.findById(id);
    if (!release) throw new PlatformReleaseNotFoundError();
    return release;
  }

  public list(criteria: PlatformReleaseListCriteria): Promise<readonly PlatformRelease[]> {
    return this.repository.list(criteria);
  }

  public async updateStatus(
    id: string,
    expectedVersion: bigint,
    target: PlatformReleaseStatus,
  ): Promise<PlatformRelease> {
    const current = await this.get(id);
    const status = transitionPlatformReleaseStatus(current.status, target);
    if (status === current.status) {
      if (current.version !== expectedVersion) throw new PlatformReleaseVersionConflictError();
      return current;
    }
    const updated = await this.repository.updateStatus(id, expectedVersion, status);
    if (!updated) throw new PlatformReleaseVersionConflictError();
    return updated;
  }
}
