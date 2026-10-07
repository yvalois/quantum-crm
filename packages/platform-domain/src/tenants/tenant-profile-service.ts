import {
  createTenantProfileDraft,
  type TenantProfile,
  type TenantProfileDraft,
  type TenantProfileStatus,
} from "./tenant-profile.js";

export interface TenantProfileCursor {
  readonly createdAt: Date;
  readonly id: string;
}

export interface TenantProfileListCriteria {
  readonly status?: TenantProfileStatus;
  readonly serverId?: string;
  readonly releaseId?: string;
  readonly search?: string;
  readonly cursor?: TenantProfileCursor;
  readonly limit: number;
}

export interface TenantProfilePage {
  readonly items: readonly TenantProfile[];
  readonly nextCursor: TenantProfileCursor | null;
}

export interface TenantProfileRepository {
  readonly create: (draft: TenantProfileDraft) => Promise<TenantProfile>;
  readonly findById: (id: string) => Promise<TenantProfile | null>;
  readonly list: (criteria: TenantProfileListCriteria) => Promise<TenantProfilePage>;
  readonly update: (
    id: string,
    expectedVersion: bigint,
    draft: TenantProfileDraft,
  ) => Promise<TenantProfile | null>;
  /** Removes only a never-provisioned draft. Provisioned profiles use ADM-03-b. */
  readonly removePending: (id: string, expectedVersion: bigint) => Promise<boolean>;
}

export class TenantProfileNotFoundError extends Error {
  public constructor() {
    super("Tenant profile not found");
    this.name = "TenantProfileNotFoundError";
  }
}

export class TenantProfileConflictError extends Error {
  public constructor() {
    super("Tenant profile conflicts with existing state");
    this.name = "TenantProfileConflictError";
  }
}

export class TenantProfileVersionConflictError extends Error {
  public constructor() {
    super("Tenant profile version is stale");
    this.name = "TenantProfileVersionConflictError";
  }
}

export interface UpdateTenantProfileCommand {
  readonly name?: string;
  readonly slug?: string;
  readonly adminContactName?: string;
  readonly adminContactEmail?: string;
}

export class TenantProfileService {
  public constructor(private readonly repository: TenantProfileRepository) {}

  public create(input: {
    readonly name: string;
    readonly slug: string;
    readonly adminContactName: string;
    readonly adminContactEmail: string;
  }): Promise<TenantProfile> {
    return this.repository.create(createTenantProfileDraft(input));
  }

  public async get(id: string): Promise<TenantProfile> {
    const profile = await this.repository.findById(id);
    if (!profile) throw new TenantProfileNotFoundError();
    return profile;
  }

  public list(criteria: TenantProfileListCriteria): Promise<TenantProfilePage> {
    return this.repository.list(criteria);
  }

  public async update(
    id: string,
    expectedVersion: bigint,
    changes: UpdateTenantProfileCommand,
  ): Promise<TenantProfile> {
    const current = await this.get(id);
    const draft = createTenantProfileDraft({
      name: changes.name ?? current.name,
      slug: changes.slug ?? current.slug,
      adminContactName: changes.adminContactName ?? current.adminContactName,
      adminContactEmail: changes.adminContactEmail ?? current.adminContactEmail,
      status: current.status,
      ...(current.serverId ? { serverId: current.serverId } : {}),
      ...(current.releaseId ? { releaseId: current.releaseId } : {}),
    });
    const updated = await this.repository.update(id, expectedVersion, draft);
    if (!updated) throw new TenantProfileVersionConflictError();
    return updated;
  }

  public async removePending(
    id: string,
    expectedVersion: bigint,
    confirmationSlug: string,
  ): Promise<void> {
    const current = await this.get(id);
    if (current.slug !== confirmationSlug.trim().toLowerCase() || current.status !== "PENDING") {
      throw new TenantProfileConflictError();
    }
    if (!(await this.repository.removePending(id, expectedVersion))) {
      throw new TenantProfileVersionConflictError();
    }
  }
}
