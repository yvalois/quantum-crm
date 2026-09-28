export type { CommercialActor, CommercialScope } from "../iam/index.js";
import type { CommercialActor } from "../iam/index.js";

export interface ContactRecord {
  readonly id: string;
  readonly ownerMemberId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ContactRepository {
  readonly list: (actor: CommercialActor) => Promise<readonly ContactRecord[]>;
  readonly find: (actor: CommercialActor, id: string) => Promise<ContactRecord | null>;
  readonly create: (input: {
    readonly contact: ContactRecord;
    readonly actor: CommercialActor;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<ContactRecord>;
  readonly update: (input: {
    readonly contact: ContactRecord;
    readonly actor: CommercialActor;
    readonly expectedVersion: bigint;
  }) => Promise<ContactRecord | null>;
  readonly importRows: (input: {
    readonly actor: CommercialActor;
    readonly rows: readonly ContactImportRow[];
    readonly operationKey: string;
    readonly payloadHash: string;
  }) => Promise<ContactImportResult>;
}

export interface ContactImportRow {
  readonly rowNumber: number;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
}

export interface ContactImportPreviewRow extends ContactImportRow {
  readonly status: "VALID" | "MATCH" | "ERROR";
  readonly contactId: string | null;
  readonly errors: readonly string[];
}

export type ContactImportResultRow = Omit<ContactImportPreviewRow, "status"> & {
  readonly status: "CREATED" | "UPDATED" | "ERROR";
};

export interface ContactImportResult {
  readonly rows: readonly ContactImportResultRow[];
  readonly created: number;
  readonly updated: number;
  readonly errors: number;
}

export class ContactValidationError extends Error {
  public constructor() {
    super("Invalid contact");
    this.name = "ContactValidationError";
  }
}

function text(value: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new ContactValidationError();
  return normalized;
}

export function createContact(input: {
  readonly id: string;
  readonly ownerMemberId: string;
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly now: Date;
}): ContactRecord {
  if (!input.id || !input.ownerMemberId || Number.isNaN(input.now.getTime()))
    throw new ContactValidationError();
  return Object.freeze({
    id: input.id,
    ownerMemberId: input.ownerMemberId,
    displayName: text(input.displayName, 160),
    email: input.email ? text(input.email, 320).toLowerCase() : null,
    phone: input.phone ? text(input.phone, 40) : null,
    version: 1n,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export function updateContact(input: {
  readonly contact: ContactRecord;
  readonly displayName?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly now: Date;
}): ContactRecord {
  if (
    (input.displayName === undefined && input.email === undefined && input.phone === undefined) ||
    Number.isNaN(input.now.getTime())
  )
    throw new ContactValidationError();
  return Object.freeze({
    ...input.contact,
    ...(input.displayName === undefined ? {} : { displayName: text(input.displayName, 160) }),
    ...(input.email === undefined
      ? {}
      : { email: input.email === null ? null : text(input.email, 320).toLowerCase() }),
    ...(input.phone === undefined
      ? {}
      : { phone: input.phone === null ? null : text(input.phone, 40) }),
    version: input.contact.version + 1n,
    updatedAt: input.now,
  });
}

export {
  ContactService,
  ContactNotFoundError,
  ContactVersionConflictError,
} from "./contact-service.js";
