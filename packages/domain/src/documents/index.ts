import type { CommercialDocumentKind, DocumentBlock, DocumentDesign } from "@quantum-crm/contracts";

import type { CommercialActor } from "../iam/index.js";

export type { CommercialDocumentKind, DocumentBlock, DocumentDesign } from "@quantum-crm/contracts";

export interface CommercialDocumentRecord {
  readonly id: string;
  readonly kind: CommercialDocumentKind;
  readonly status: "DRAFT";
  readonly title: string;
  readonly contactId: string | null;
  readonly opportunityId: string | null;
  readonly ownerMemberId: string;
  readonly sourceTemplateId: string | null;
  readonly blocks: readonly DocumentBlock[];
  readonly design: DocumentDesign;
  readonly revision: number;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DocumentTemplateRecord {
  readonly id: string;
  readonly kind: CommercialDocumentKind;
  readonly name: string;
  readonly blocks: readonly DocumentBlock[];
  readonly design: DocumentDesign;
  readonly revision: number;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DocumentListFilters {
  readonly kind?: CommercialDocumentKind;
  readonly status?: "DRAFT";
}

export interface DocumentRepository {
  readonly list: (
    actor: CommercialActor,
    filters: DocumentListFilters,
  ) => Promise<readonly CommercialDocumentRecord[]>;
  readonly find: (actor: CommercialActor, id: string) => Promise<CommercialDocumentRecord | null>;
  readonly create: (input: {
    readonly document: CommercialDocumentRecord;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<CommercialDocumentRecord>;
  readonly update: (input: {
    readonly actor: CommercialActor;
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly title: string;
    readonly contactId: string | null;
    readonly opportunityId: string | null;
    readonly blocks: readonly DocumentBlock[];
    readonly design: DocumentDesign;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<CommercialDocumentRecord | null>;
  readonly listTemplates: (
    kind?: CommercialDocumentKind,
  ) => Promise<readonly DocumentTemplateRecord[]>;
  readonly findTemplate: (id: string) => Promise<DocumentTemplateRecord | null>;
  readonly createTemplate: (input: {
    readonly template: DocumentTemplateRecord;
    readonly actorMemberId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<DocumentTemplateRecord>;
  readonly updateTemplate: (input: {
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly name: string;
    readonly blocks: readonly DocumentBlock[];
    readonly design: DocumentDesign;
    readonly actorMemberId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<DocumentTemplateRecord | null>;
}

export interface DocumentReferenceLookup {
  readonly contactExistsFor: (actor: CommercialActor, contactId: string) => Promise<boolean>;
  readonly opportunityExistsFor: (
    actor: CommercialActor,
    opportunityId: string,
  ) => Promise<boolean>;
  /** Optional contextual data used only to snapshot approved template variables. */
  readonly contactFor?: (
    actor: CommercialActor,
    contactId: string,
  ) => Promise<{
    readonly displayName: string;
    readonly email: string | null;
    readonly phone: string | null;
  } | null>;
  readonly memberFor?: (
    memberId: string,
  ) => Promise<{ readonly displayName: string; readonly email: string } | null>;
}

export class DocumentNotFoundError extends Error {
  public constructor() {
    super("Document resource not found");
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentValidationError extends Error {
  public constructor(message = "Invalid document operation") {
    super(message);
    this.name = "DocumentValidationError";
  }
}

export class DocumentVersionConflictError extends Error {
  public constructor() {
    super("Document resource has changed");
    this.name = "DocumentVersionConflictError";
  }
}

export {
  DocumentService,
  defaultDocumentDesign,
  starterDocumentBlocks,
} from "./document-service.js";
