export const profileOperatorStatuses = ["PENDING", "ACTIVE", "FAILED"] as const;
export type ProfileOperatorStatus = (typeof profileOperatorStatuses)[number];

export interface ProfileOperatorAssignment {
  readonly id: string;
  readonly tenantProfileId: string;
  readonly requestedByOperatorId: string;
  readonly operatorId: string | null;
  readonly crmMemberId: string | null;
  readonly oidcSubject: string | null;
  readonly displayName: string;
  readonly email: string;
  readonly status: ProfileOperatorStatus;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class ProfileOperatorValidationError extends Error {
  public constructor() {
    super("Invalid profile operator request");
    this.name = "ProfileOperatorValidationError";
  }
}

export class ProfileOperatorConflictError extends Error {
  public constructor() {
    super("Profile operator request conflicts with current state");
    this.name = "ProfileOperatorConflictError";
  }
}

export interface ProfileOperatorRepository {
  readonly list: (tenantProfileId: string) => Promise<readonly ProfileOperatorAssignment[]>;
  readonly request: (command: {
    readonly id: string;
    readonly tenantProfileId: string;
    readonly requestedByOperatorId: string;
    readonly displayName: string;
    readonly email: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly now: Date;
  }) => Promise<{
    readonly assignment: ProfileOperatorAssignment;
    readonly idempotentReplay: boolean;
  }>;
  readonly claimNext: (command: {
    readonly workerId: string;
    readonly leaseDurationSeconds: number;
    readonly now: Date;
  }) => Promise<ProfileOperatorAssignment | null>;
  readonly complete: (command: {
    readonly assignmentId: string;
    readonly workerId: string;
    readonly expectedVersion: bigint;
    readonly memberId: string;
    readonly oidcSubject: string;
    readonly now: Date;
  }) => Promise<ProfileOperatorAssignment | null>;
  readonly fail: (command: {
    readonly assignmentId: string;
    readonly workerId: string;
    readonly expectedVersion: bigint;
    readonly now: Date;
  }) => Promise<ProfileOperatorAssignment | null>;
}
