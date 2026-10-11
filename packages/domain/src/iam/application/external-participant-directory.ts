import type { SourceParticipants } from "@quantum-crm/contracts";
import type { HistoricalImportContext } from "../../shared/historical-import.js";
import { HistoricalImportValidationError } from "../../shared/historical-import.js";

export type { SourceParticipants } from "@quantum-crm/contracts";

/** Internal references projected by the owning resource, never an API payload. */
export interface SourceParticipantReferences {
  readonly locationId: string;
  readonly ownerExternalId: string | null;
  readonly followerExternalIds: readonly string[];
}
export interface SourceParticipantRecord {
  readonly sourceParticipantReferences?: SourceParticipantReferences;
  readonly sourceParticipants?: SourceParticipants;
}
export interface ExternalParticipantName {
  readonly locationId: string;
  readonly externalId: string;
  readonly displayName: string;
}
export interface ExternalParticipantLookup {
  /** Call only with references belonging to resources already authorized by their owner. */
  readonly resolve: (references: readonly SourceParticipantReferences[]) => Promise<readonly ExternalParticipantName[]>;
}
export interface ExternalParticipantImportResult {
  readonly total: number;
  readonly created: number;
  readonly replayed: number;
}
export interface ExternalParticipantDirectory extends ExternalParticipantLookup {
  readonly importDirectory: (context: HistoricalImportContext, input: {
    readonly operationId: string;
    readonly locationId: string;
    readonly participants: readonly { readonly externalId: string; readonly displayName: string }[];
  }) => Promise<ExternalParticipantImportResult>;
}

/** Accept only the narrow SQL projection, never propagate an import source payload. */
export function sourceParticipantReferencesFromRow(value: unknown): SourceParticipantRecord {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new HistoricalImportValidationError();
  const row = value as Record<string, unknown>;
  const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(id);
  if (!validId(row.locationId) || (row.ownerExternalId !== null && !validId(row.ownerExternalId)) ||
    !Array.isArray(row.followerExternalIds) || row.followerExternalIds.length > 500 ||
    !row.followerExternalIds.every(validId)) throw new HistoricalImportValidationError();
  return { sourceParticipantReferences: {
    locationId: row.locationId,
    ownerExternalId: row.ownerExternalId,
    followerExternalIds: [...new Set(row.followerExternalIds)],
  } };
}

export class ExternalParticipantConflictError extends Error {
  public constructor() {
    super("External participant directory conflicts with its historical snapshot");
    this.name = "ExternalParticipantConflictError";
  }
}

/** Batch resolution preserves the resource's Quantum owner and removes internal location IDs. */
export async function withSourceParticipants<T extends SourceParticipantRecord>(
  records: readonly T[],
  directory?: ExternalParticipantLookup,
): Promise<readonly T[]> {
  const references = records.flatMap((record) => record.sourceParticipantReferences ? [record.sourceParticipantReferences] : []);
  if (references.length === 0) return records;
  const names = directory ? await directory.resolve(references) : [];
  const indexed = new Map(names.map((entry) => [JSON.stringify([entry.locationId, entry.externalId]), entry.displayName]));
  return records.map((record) => {
    const { sourceParticipantReferences: reference, ...visible } = record;
    if (!reference) return record;
    const participant = (externalId: string) => ({
      externalId,
      displayName: indexed.get(JSON.stringify([reference.locationId, externalId])) ?? null,
    });
    return {
      ...visible,
      sourceParticipants: {
        source: "GHL",
        owner: reference.ownerExternalId ? participant(reference.ownerExternalId) : null,
        followers: [...new Set(reference.followerExternalIds)].map(participant),
      },
    } as T;
  });
}
