import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";

export type HistoricalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly HistoricalJsonValue[]
  | { readonly [key: string]: HistoricalJsonValue };

export interface HistoricalImportSource {
  readonly system: "GHL";
  readonly locationId: string;
  readonly externalId: string;
  readonly payloadHash: string;
  /** Preserved privately for reconciliation; never returned through commercial APIs. */
  readonly raw: HistoricalJsonValue;
}

export interface HistoricalImportContext {
  readonly actor: CommercialActor;
  readonly permissions: readonly IamPermission[];
}

export interface HistoricalImportResult {
  readonly id: string;
  readonly status: "CREATED" | "REPLAYED" | "SOURCE_CHANGED";
}

export class HistoricalImportValidationError extends Error {
  public constructor() {
    super("Invalid historical import record");
    this.name = "HistoricalImportValidationError";
  }
}

export function authorizeHistoricalImport(
  context: HistoricalImportContext,
  permission: IamPermission,
): void {
  if (context.actor.scope !== "PROFILE" || !context.permissions.includes(permission)) {
    throw new IamAuthorizationError();
  }
}

export function validateHistoricalSource(source: HistoricalImportSource): void {
  if (
    source.system !== "GHL" ||
    !/^[A-Za-z0-9_-]{1,200}$/u.test(source.locationId) ||
    !/^[A-Za-z0-9_.:-]{1,300}$/u.test(source.externalId) ||
    !/^[a-f0-9]{64}$/u.test(source.payloadHash)
  ) throw new HistoricalImportValidationError();
  validateHistoricalJson(source.raw);
}

export function validateHistoricalJson(value: HistoricalJsonValue, depth = 0): void {
  if (depth > 25) throw new HistoricalImportValidationError();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 1_000_000) throw new HistoricalImportValidationError();
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new HistoricalImportValidationError();
    return;
  }
  if (typeof value !== "object") throw new HistoricalImportValidationError();
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null) throw new HistoricalImportValidationError();
  const values = Array.isArray(value) ? value : Object.values(value);
  if (values.length > 10_000) throw new HistoricalImportValidationError();
  for (const item of values) validateHistoricalJson(item as HistoricalJsonValue, depth + 1);
}

export function validateHistoricalDates(createdAt: Date, updatedAt: Date): void {
  if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(updatedAt.getTime())) {
    throw new HistoricalImportValidationError();
  }
}
