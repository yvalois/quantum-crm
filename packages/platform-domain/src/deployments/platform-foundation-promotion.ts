const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const workerIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export const platformFoundationPromotionStatuses = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type PlatformFoundationPromotionStatus = (typeof platformFoundationPromotionStatuses)[number];

export interface PlatformFoundationPromotion {
  readonly id: string;
  readonly releaseId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly status: PlatformFoundationPromotionStatus;
  readonly attempt: number;
  readonly version: bigint;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly failureCode: "UNAVAILABLE" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT" | "PERMISSION_DENIED" | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RequestPlatformFoundationPromotionCommand {
  readonly id: string;
  readonly releaseId: string;
  readonly requestedByOperatorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface ClaimPlatformFoundationPromotionCommand {
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
}

export interface CompletePlatformFoundationPromotionCommand {
  readonly id: string;
  readonly workerId: string;
  readonly expectedVersion: bigint;
  readonly attempt: number;
  readonly failureCode?: "UNAVAILABLE" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT" | "PERMISSION_DENIED";
}

export interface PlatformFoundationPromotionRepository {
  readonly request: (command: RequestPlatformFoundationPromotionCommand) => Promise<{
    readonly promotion: PlatformFoundationPromotion;
    readonly idempotentReplay: boolean;
  }>;
  readonly claimNext: (command: ClaimPlatformFoundationPromotionCommand) => Promise<PlatformFoundationPromotion | null>;
  readonly complete: (command: CompletePlatformFoundationPromotionCommand) => Promise<PlatformFoundationPromotion | null>;
}

export class PlatformFoundationPromotionValidationError extends Error {
  public constructor(field: string) {
    super(`Invalid platform foundation promotion field: ${field}`);
    this.name = "PlatformFoundationPromotionValidationError";
  }
}

export function validatePlatformFoundationPromotionRequest(
  command: RequestPlatformFoundationPromotionCommand,
): RequestPlatformFoundationPromotionCommand {
  for (const [field, value] of [
    ["id", command.id],
    ["releaseId", command.releaseId],
    ["requestedByOperatorId", command.requestedByOperatorId],
  ] as const) {
    if (!uuidPattern.test(value)) throw new PlatformFoundationPromotionValidationError(field);
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(command.idempotencyKey)) {
    throw new PlatformFoundationPromotionValidationError("idempotencyKey");
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(command.correlationId)) {
    throw new PlatformFoundationPromotionValidationError("correlationId");
  }
  return Object.freeze({ ...command });
}

export function validatePlatformFoundationPromotionClaim(
  command: ClaimPlatformFoundationPromotionCommand,
): ClaimPlatformFoundationPromotionCommand {
  if (!workerIdPattern.test(command.workerId)) {
    throw new PlatformFoundationPromotionValidationError("workerId");
  }
  if (!Number.isInteger(command.leaseDurationSeconds) || command.leaseDurationSeconds < 1 || command.leaseDurationSeconds > 300) {
    throw new PlatformFoundationPromotionValidationError("leaseDurationSeconds");
  }
  return Object.freeze({ ...command });
}

export function validatePlatformFoundationPromotionCompletion(
  command: CompletePlatformFoundationPromotionCommand,
): CompletePlatformFoundationPromotionCommand {
  if (!uuidPattern.test(command.id)) throw new PlatformFoundationPromotionValidationError("id");
  if (!workerIdPattern.test(command.workerId)) throw new PlatformFoundationPromotionValidationError("workerId");
  if (command.expectedVersion < 1n) throw new PlatformFoundationPromotionValidationError("expectedVersion");
  if (!Number.isInteger(command.attempt) || command.attempt < 1) {
    throw new PlatformFoundationPromotionValidationError("attempt");
  }
  if (command.failureCode && !["UNAVAILABLE", "IDENTITY_MISMATCH", "TARGET_CONFLICT", "PERMISSION_DENIED"].includes(command.failureCode)) {
    throw new PlatformFoundationPromotionValidationError("failureCode");
  }
  return Object.freeze({ ...command });
}
