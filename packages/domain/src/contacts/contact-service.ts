import { randomUUID } from "node:crypto";

import { IamAuthorizationError, type IamPermission } from "../iam/index.js";
import { createContact, type CommercialActor, type ContactRecord, type ContactRepository, updateContact } from "./index.js";

export class ContactNotFoundError extends Error { public constructor() { super("Contact not found"); this.name = "ContactNotFoundError"; } }
export class ContactVersionConflictError extends Error { public constructor() { super("Contact has changed"); this.name = "ContactVersionConflictError"; } }

function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

export class ContactService {
  public constructor(private readonly repository: ContactRepository, private readonly clock: () => Date = () => new Date()) {}

  public list(actor: CommercialActor, permissions: readonly IamPermission[]) { allow(permissions, "crm:contacts:read"); return this.repository.list(actor); }
  public get(actor: CommercialActor, permissions: readonly IamPermission[], id: string): Promise<ContactRecord> {
    allow(permissions, "crm:contacts:read");
    return this.repository.find(actor, id).then((contact) => { if (!contact) throw new ContactNotFoundError(); return contact; });
  }
  public create(input: { readonly actor: CommercialActor; readonly permissions: readonly IamPermission[]; readonly displayName: string; readonly email?: string; readonly phone?: string; readonly idempotencyKey: string; readonly payloadHash: string }) {
    allow(input.permissions, "crm:contacts:create");
    return this.repository.create({
      contact: createContact({ id: randomUUID(), ownerMemberId: input.actor.memberId, displayName: input.displayName, ...(input.email === undefined ? {} : { email: input.email }), ...(input.phone === undefined ? {} : { phone: input.phone }), now: this.clock() }),
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }
  public async update(input: { readonly actor: CommercialActor; readonly permissions: readonly IamPermission[]; readonly id: string; readonly displayName?: string; readonly email?: string | null; readonly phone?: string | null; readonly expectedVersion: bigint }): Promise<ContactRecord> {
    allow(input.permissions, "crm:contacts:update");
    const current = await this.repository.find(input.actor, input.id);
    if (!current) throw new ContactNotFoundError();
    if (current.version !== input.expectedVersion) throw new ContactVersionConflictError();
    const updated = await this.repository.update({
      contact: updateContact({ contact: current, ...(input.displayName === undefined ? {} : { displayName: input.displayName }), ...(input.email === undefined ? {} : { email: input.email }), ...(input.phone === undefined ? {} : { phone: input.phone }), now: this.clock() }),
      actor: input.actor,
      expectedVersion: input.expectedVersion,
    });
    if (!updated) throw new ContactVersionConflictError();
    return updated;
  }
}
