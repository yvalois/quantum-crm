import { randomUUID } from "node:crypto";

import type { CommercialDocumentKind, DocumentBlock, DocumentDesign } from "@quantum-crm/contracts";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import {
  type CommercialDocumentRecord,
  DocumentNotFoundError,
  type DocumentReferenceLookup,
  type DocumentRepository,
  type DocumentTemplateRecord,
  DocumentValidationError,
  DocumentVersionConflictError,
} from "./index.js";

function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

function cloneBlocks(blocks: readonly DocumentBlock[]): readonly DocumentBlock[] {
  return Object.freeze(structuredClone(blocks));
}

function cloneDesign(design: DocumentDesign): DocumentDesign {
  return Object.freeze(structuredClone(design));
}

function requireTitle(value: string, maximum: number): string {
  const title = value.trim();
  if (title.length < 1 || title.length > maximum) throw new DocumentValidationError();
  return title;
}

export function defaultDocumentDesign(): DocumentDesign {
  return Object.freeze({
    accentColor: "#15b8a6",
    textColor: "#102125",
    fontFamily: "INSTRUMENT_SANS",
    pageSize: "A4",
    headerText: "",
    footerText: "Documento generado con Quantum",
    showPageNumbers: true,
    logoFileId: null,
    logoChecksum: null,
    backgroundFileId: null,
    backgroundChecksum: null,
  });
}

export function starterDocumentBlocks(): readonly DocumentBlock[] {
  return Object.freeze([
    Object.freeze({
      id: randomUUID(),
      type: "TEXT" as const,
      locked: false,
      content: "Propuesta preparada para {{contact.name}}",
      align: "LEFT" as const,
    }),
    Object.freeze({
      id: randomUUID(),
      type: "TERMS" as const,
      locked: false,
      title: "Condiciones comerciales",
      content: "Agrega aqui vigencia, garantias y observaciones.",
    }),
  ]);
}

function assertLockedBlocks(
  current: readonly DocumentBlock[],
  candidate: readonly DocumentBlock[],
): void {
  for (const [index, block] of current.entries()) {
    if (!block.locked) continue;
    const next = candidate[index];
    if (!next || JSON.stringify(block) !== JSON.stringify(next)) {
      throw new DocumentValidationError("Protected template blocks cannot be changed or moved");
    }
  }
}

export class DocumentService {
  public constructor(
    private readonly repository: DocumentRepository,
    private readonly references: DocumentReferenceLookup,
  ) {}

  public async list(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    filters: { readonly kind?: CommercialDocumentKind; readonly status?: "DRAFT" },
  ): Promise<readonly CommercialDocumentRecord[]> {
    allow(permissions, "crm:documents:read");
    return this.repository.list(actor, filters);
  }

  public async get(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    id: string,
  ): Promise<CommercialDocumentRecord> {
    allow(permissions, "crm:documents:read");
    const document = await this.repository.find(actor, id);
    if (!document) throw new DocumentNotFoundError();
    return document;
  }

  public async create(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly kind: CommercialDocumentKind;
    readonly title: string;
    readonly contactId: string | null;
    readonly opportunityId: string | null;
    readonly templateId: string | null;
    readonly blocks?: readonly DocumentBlock[];
    readonly design?: DocumentDesign;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now?: Date;
  }): Promise<CommercialDocumentRecord> {
    allow(input.permissions, "crm:documents:create");
    await this.assertReferences(input.actor, input.contactId, input.opportunityId);
    const template = input.templateId ? await this.repository.findTemplate(input.templateId) : null;
    if (input.templateId && !template) throw new DocumentNotFoundError();
    if (template && template.kind !== input.kind)
      throw new DocumentValidationError("Template kind does not match document kind");
    const now = input.now ?? new Date();
    return this.repository.create({
      document: Object.freeze({
        id: randomUUID(),
        kind: input.kind,
        status: "DRAFT",
        title: requireTitle(input.title, 240),
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        ownerMemberId: input.actor.memberId,
        sourceTemplateId: template?.id ?? null,
        blocks: cloneBlocks(template?.blocks ?? input.blocks ?? starterDocumentBlocks()),
        design: cloneDesign(template?.design ?? input.design ?? defaultDocumentDesign()),
        revision: 1,
        version: 1n,
        createdAt: now,
        updatedAt: now,
      }),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }

  public async update(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly patch: {
      readonly title?: string;
      readonly contactId?: string | null;
      readonly opportunityId?: string | null;
      readonly blocks?: readonly DocumentBlock[];
      readonly design?: DocumentDesign;
    };
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now?: Date;
  }): Promise<CommercialDocumentRecord> {
    allow(input.permissions, "crm:documents:update");
    const current = await this.repository.find(input.actor, input.id);
    if (!current) throw new DocumentNotFoundError();
    if (current.version !== input.expectedVersion) throw new DocumentVersionConflictError();
    const contactId =
      input.patch.contactId === undefined ? current.contactId : input.patch.contactId;
    const opportunityId =
      input.patch.opportunityId === undefined ? current.opportunityId : input.patch.opportunityId;
    await this.assertReferences(input.actor, contactId, opportunityId);
    const blocks = input.patch.blocks ?? current.blocks;
    if (current.sourceTemplateId) assertLockedBlocks(current.blocks, blocks);
    const updated = await this.repository.update({
      actor: input.actor,
      id: input.id,
      expectedVersion: input.expectedVersion,
      title: input.patch.title === undefined ? current.title : requireTitle(input.patch.title, 240),
      contactId,
      opportunityId,
      blocks: cloneBlocks(blocks),
      design: cloneDesign(input.patch.design ?? current.design),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      now: input.now ?? new Date(),
    });
    if (!updated) throw new DocumentVersionConflictError();
    return updated;
  }

  public async duplicate(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly sourceId: string;
    readonly title?: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now?: Date;
  }): Promise<CommercialDocumentRecord> {
    allow(input.permissions, "crm:documents:read");
    allow(input.permissions, "crm:documents:create");
    const source = await this.repository.find(input.actor, input.sourceId);
    if (!source) throw new DocumentNotFoundError();
    return this.create({
      actor: input.actor,
      permissions: input.permissions,
      kind: source.kind,
      title: input.title ?? `${source.title} (copia)`,
      contactId: source.contactId,
      opportunityId: source.opportunityId,
      templateId: null,
      blocks: source.blocks,
      design: source.design,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  }

  public async listTemplates(
    permissions: readonly IamPermission[],
    kind?: CommercialDocumentKind,
  ): Promise<readonly DocumentTemplateRecord[]> {
    allow(permissions, "crm:documents:read");
    return this.repository.listTemplates(kind);
  }

  public async createTemplate(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly name: string;
    readonly sourceDocumentId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now?: Date;
  }): Promise<DocumentTemplateRecord> {
    allow(input.permissions, "crm:documents:templates");
    const source = await this.repository.find(input.actor, input.sourceDocumentId);
    if (!source) throw new DocumentNotFoundError();
    const now = input.now ?? new Date();
    return this.repository.createTemplate({
      template: Object.freeze({
        id: randomUUID(),
        kind: source.kind,
        name: requireTitle(input.name, 180),
        blocks: cloneBlocks(source.blocks),
        design: cloneDesign(source.design),
        revision: 1,
        version: 1n,
        createdAt: now,
        updatedAt: now,
      }),
      actorMemberId: input.actor.memberId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }

  public async updateTemplate(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly patch: {
      readonly name?: string;
      readonly blocks?: readonly DocumentBlock[];
      readonly design?: DocumentDesign;
    };
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now?: Date;
  }): Promise<DocumentTemplateRecord> {
    allow(input.permissions, "crm:documents:templates");
    const current = await this.repository.findTemplate(input.id);
    if (!current) throw new DocumentNotFoundError();
    if (current.version !== input.expectedVersion) throw new DocumentVersionConflictError();
    const updated = await this.repository.updateTemplate({
      id: input.id,
      expectedVersion: input.expectedVersion,
      name: input.patch.name === undefined ? current.name : requireTitle(input.patch.name, 180),
      blocks: cloneBlocks(input.patch.blocks ?? current.blocks),
      design: cloneDesign(input.patch.design ?? current.design),
      actorMemberId: input.actor.memberId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      now: input.now ?? new Date(),
    });
    if (!updated) throw new DocumentVersionConflictError();
    return updated;
  }

  private async assertReferences(
    actor: CommercialActor,
    contactId: string | null,
    opportunityId: string | null,
  ): Promise<void> {
    if (contactId && !(await this.references.contactExistsFor(actor, contactId)))
      throw new DocumentValidationError("Contact is not available");
    if (opportunityId && !(await this.references.opportunityExistsFor(actor, opportunityId)))
      throw new DocumentValidationError("Opportunity is not available");
  }
}
