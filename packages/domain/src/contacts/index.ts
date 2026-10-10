export type { CommercialActor, CommercialScope } from "../iam/index.js";
import type { CommercialActor } from "../iam/index.js";

export type ContactChannel = "EMAIL" | "PHONE" | "NONE";
export type ContactSource =
  "MANUAL" | "IMPORT" | "FORM" | "CONVERSATION" | "API" | "MIGRATION" | "OTHER";
export type ContactListSort = "UPDATED_DESC" | "CREATED_DESC" | "NAME_ASC";
export type ContactCursorDirection = "NEXT" | "PREVIOUS";

export interface ContactLabel {
  readonly id: string;
  readonly name: string;
}

export interface ContactListCursor {
  readonly direction: ContactCursorDirection;
  readonly value: string;
  readonly id: string;
}

export interface ContactListFilters {
  readonly q?: string;
  readonly label?: string;
  readonly pipelineId?: string;
  readonly ownerMemberId?: string;
  readonly channel?: ContactChannel;
  readonly source?: ContactSource;
  /** Undefined retains the active-contact default. `true` includes only archived contacts. */
  readonly archived?: boolean;
  /** Internal callers such as import matching can include both lifecycle states. */
  readonly includeArchived?: boolean;
  readonly assignment?: "UNASSIGNED";
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly limit?: number;
  readonly cursor?: ContactListCursor;
  readonly sort?: ContactListSort;
}

export interface ContactRecord {
  readonly id: string;
  readonly ownerMemberId: string | null;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly labels: readonly ContactLabel[];
  readonly source: ContactSource;
  readonly archivedAt: Date | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ContactPage {
  readonly records: readonly ContactRecord[];
  readonly total: number;
  readonly hasMoreInRequestedDirection: boolean;
}

export type ContactBulkAction =
  | {
      readonly action: "ASSIGN";
      readonly contactIds: readonly string[];
      readonly ownerMemberId: string | null;
    }
  | {
      readonly action: "ADD_LABEL" | "REMOVE_LABEL";
      readonly contactIds: readonly string[];
      readonly labelId: string;
    }
  | { readonly action: "ARCHIVE" | "RESTORE"; readonly contactIds: readonly string[] };

export interface ContactBulkActionResult {
  readonly contactId: string;
  readonly status: "UPDATED" | "UNCHANGED" | "NOT_VISIBLE";
}

export interface ContactBulkActionResponse {
  readonly results: readonly ContactBulkActionResult[];
  readonly updated: number;
  readonly unchanged: number;
  readonly notVisible: number;
}

export interface ContactRepository {
  readonly list: (
    actor: CommercialActor,
    filters?: ContactListFilters,
  ) => Promise<readonly ContactRecord[]>;
  readonly listPage: (actor: CommercialActor, filters: ContactListFilters) => Promise<ContactPage>;
  readonly find: (actor: CommercialActor, id: string) => Promise<ContactRecord | null>;
  readonly listLabels: (actor: CommercialActor) => Promise<readonly ContactLabel[]>;
  readonly createLabel: (input: {
    readonly actor: CommercialActor;
    readonly name: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<ContactLabel>;
  readonly canAssignOwner: (actor: CommercialActor, ownerMemberId: string) => Promise<boolean>;
  readonly create: (input: {
    readonly contact: ContactRecord;
    readonly actor: CommercialActor;
    readonly labelIds: readonly string[];
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<ContactRecord>;
  readonly update: (input: {
    readonly contact: ContactRecord;
    readonly actor: CommercialActor;
    readonly expectedVersion: bigint;
  }) => Promise<ContactRecord | null>;
  readonly bulk: (input: {
    readonly actor: CommercialActor;
    readonly action: ContactBulkAction;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<ContactBulkActionResponse>;
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
  readonly ownerMemberId: string | null;
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
  readonly source?: ContactSource;
  readonly now: Date;
}): ContactRecord {
  if (!input.id || Number.isNaN(input.now.getTime())) throw new ContactValidationError();
  return Object.freeze({
    id: input.id,
    ownerMemberId: input.ownerMemberId,
    displayName: text(input.displayName, 160),
    email: input.email ? text(input.email, 320).toLowerCase() : null,
    phone: input.phone ? text(input.phone, 40) : null,
    labels: Object.freeze([]),
    source: input.source ?? "MANUAL",
    archivedAt: null,
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
