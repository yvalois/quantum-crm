import type { FormAnswerValue, FormDefinition, FormTheme } from "@quantum-crm/contracts";

export type { FormAnswerValue, FormDefinition, FormTheme } from "@quantum-crm/contracts";

export interface FormRecord {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly status: "DRAFT" | "PUBLISHED" | "CLOSED";
  readonly definition: FormDefinition;
  readonly theme: FormTheme;
  readonly publishedRevision: number | null;
  readonly closesAt: Date | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PublishedFormRecord {
  readonly form: FormRecord;
  readonly revision: number;
  readonly definition: FormDefinition;
  readonly theme: FormTheme;
  readonly publishedAt: Date;
}

export interface SubmittedFormRecord {
  readonly id: string;
  readonly formId: string;
  readonly formRevision: number;
  readonly contactId: string | null;
  readonly answers: Readonly<Record<string, FormAnswerValue>>;
  readonly submittedAt: Date;
}

export interface FormRepository {
  readonly list: () => Promise<readonly FormRecord[]>;
  readonly find: (id: string) => Promise<FormRecord | null>;
  readonly findPublishedBySlug: (slug: string) => Promise<PublishedFormRecord | null>;
  readonly create: (input: {
    readonly form: FormRecord;
    readonly actorMemberId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<FormRecord>;
  readonly update: (input: {
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly patch: Partial<
      Pick<FormRecord, "title" | "description" | "definition" | "theme" | "closesAt">
    >;
    readonly actorMemberId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<FormRecord | null>;
  readonly publish: (input: {
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly actorMemberId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<FormRecord | null>;
  readonly close: (input: {
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly actorMemberId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<FormRecord | null>;
  readonly submit: (input: {
    readonly submission: SubmittedFormRecord;
    readonly slug: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<SubmittedFormRecord>;
  readonly responses: (
    formId: string,
    filters: { readonly from?: Date; readonly to?: Date; readonly limit: number },
  ) => Promise<readonly SubmittedFormRecord[]>;
}

export class FormNotFoundError extends Error {
  public constructor() {
    super("Form resource not found");
    this.name = "FormNotFoundError";
  }
}
export class FormClosedError extends Error {
  public constructor() {
    super("Form is closed");
    this.name = "FormClosedError";
  }
}
export class FormValidationError extends Error {
  public constructor(message = "Invalid form operation") {
    super(message);
    this.name = "FormValidationError";
  }
}
export class FormVersionConflictError extends Error {
  public constructor() {
    super("Form resource has changed");
    this.name = "FormVersionConflictError";
  }
}

export { FormService, isFormFieldVisible, validateFormAnswers } from "./form-service.js";
