import { randomUUID } from "node:crypto";

import { IamAuthorizationError, type IamPermission } from "../iam/index.js";
import {
  createContact,
  type CommercialActor,
  type ContactRecord,
  type ContactImportPreviewRow,
  type ContactImportResult,
  type ContactImportRow,
  type ContactListFilters,
  type ContactRepository,
  ContactValidationError,
  updateContact,
} from "./index.js";

export class ContactNotFoundError extends Error {
  public constructor() {
    super("Contact not found");
    this.name = "ContactNotFoundError";
  }
}
export class ContactVersionConflictError extends Error {
  public constructor() {
    super("Contact has changed");
    this.name = "ContactVersionConflictError";
  }
}

function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

export class ContactService {
  public constructor(
    private readonly repository: ContactRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public list(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    filters?: ContactListFilters,
  ) {
    allow(permissions, "crm:contacts:read");
    return this.repository.list(actor, filters);
  }
  public get(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    id: string,
  ): Promise<ContactRecord> {
    allow(permissions, "crm:contacts:read");
    return this.repository.find(actor, id).then((contact) => {
      if (!contact) throw new ContactNotFoundError();
      return contact;
    });
  }
  public create(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly displayName: string;
    readonly email?: string;
    readonly phone?: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:contacts:create");
    return this.repository.create({
      contact: createContact({
        id: randomUUID(),
        ownerMemberId: input.actor.memberId,
        displayName: input.displayName,
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        now: this.clock(),
      }),
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }
  public async update(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly displayName?: string;
    readonly email?: string | null;
    readonly phone?: string | null;
    readonly expectedVersion: bigint;
  }): Promise<ContactRecord> {
    allow(input.permissions, "crm:contacts:update");
    const current = await this.repository.find(input.actor, input.id);
    if (!current) throw new ContactNotFoundError();
    if (current.version !== input.expectedVersion) throw new ContactVersionConflictError();
    const updated = await this.repository.update({
      contact: updateContact({
        contact: current,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        now: this.clock(),
      }),
      actor: input.actor,
      expectedVersion: input.expectedVersion,
    });
    if (!updated) throw new ContactVersionConflictError();
    return updated;
  }

  public async previewImport(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    rows: readonly ContactImportRow[],
  ): Promise<readonly ContactImportPreviewRow[]> {
    allow(permissions, "crm:contacts:read");
    const contacts = await this.repository.list(actor);
    return Object.freeze(
      rows.map((row) => {
        const errors = validateImportRow(row);
        const match = errors.length === 0 ? findMatch(contacts, row) : null;
        return Object.freeze({
          ...row,
          status:
            errors.length > 0
              ? ("ERROR" as const)
              : match
                ? ("MATCH" as const)
                : ("VALID" as const),
          contactId: match?.id ?? null,
          errors: Object.freeze(errors),
        });
      }),
    );
  }

  public importRows(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly rows: readonly ContactImportRow[];
    readonly operationKey: string;
    readonly payloadHash: string;
  }): Promise<ContactImportResult> {
    allow(input.permissions, "crm:contacts:create");
    allow(input.permissions, "crm:contacts:update");
    const invalid = input.rows.filter((row) => validateImportRow(row).length > 0);
    if (invalid.length > 0) {
      throw new ContactValidationError();
    }
    return this.repository.importRows({
      actor: input.actor,
      rows: input.rows,
      operationKey: input.operationKey,
      payloadHash: input.payloadHash,
    });
  }

  public exportRows(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    filters?: ContactListFilters,
  ) {
    allow(permissions, "crm:contacts:read");
    allow(permissions, "crm:contacts:export");
    return this.repository.list(actor, filters);
  }
}

function normalize(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function findMatch(
  contacts: readonly ContactRecord[],
  row: ContactImportRow,
): ContactRecord | null {
  const email = normalize(row.email);
  const phone = normalize(row.phone);
  return (
    contacts.find(
      (contact) =>
        (email !== null && normalize(contact.email) === email) ||
        (phone !== null && normalize(contact.phone) === phone),
    ) ?? null
  );
}

function validateImportRow(row: ContactImportRow): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(row.rowNumber) || row.rowNumber < 2) errors.push("row_number_invalid");
  if (!row.displayName.trim() || row.displayName.trim().length > 160)
    errors.push("display_name_invalid");
  if (row.email !== null && (!row.email.trim() || row.email.trim().length > 320))
    errors.push("email_invalid");
  if (row.phone !== null && (!row.phone.trim() || row.phone.trim().length > 40))
    errors.push("phone_invalid");
  if (row.email === null && row.phone === null) errors.push("contact_channel_required");
  return errors;
}
