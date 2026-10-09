import { randomUUID } from "node:crypto";

import type { FormAnswerValue, FormDefinition, FormField, FormTheme } from "@quantum-crm/contracts";

import { IamAuthorizationError, type IamPermission } from "../iam/index.js";
import {
  FormClosedError,
  FormNotFoundError,
  type FormRecord,
  type FormRepository,
  FormValidationError,
  FormVersionConflictError,
} from "./index.js";

function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

function slug(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
  return `${base || "formulario"}-${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
}

function comparable(value: FormAnswerValue | undefined): string {
  return Array.isArray(value) ? value.join("\u0000") : String(value ?? "");
}

export function isFormFieldVisible(
  field: FormField,
  answers: Readonly<Record<string, FormAnswerValue>>,
): boolean {
  if (!field.condition) return true;
  const current = answers[field.condition.sourceFieldId];
  if (field.condition.operator === "NOT_EMPTY") {
    return Array.isArray(current) ? current.length > 0 : comparable(current).trim().length > 0;
  }
  const expected = comparable(field.condition.value);
  const actual = comparable(current);
  if (field.condition.operator === "EQUALS") return actual === expected;
  if (field.condition.operator === "NOT_EQUALS") return actual !== expected;
  return Array.isArray(current) ? current.includes(expected) : actual.includes(expected);
}

function validFor(field: FormField, value: FormAnswerValue): boolean {
  if (field.type === "IMAGE_UPLOAD") {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      "fileIds" in value &&
      Array.isArray(value.fileIds) &&
      value.fileIds.length > 0
    );
  }
  if (["SHORT_TEXT", "LONG_TEXT", "EMAIL", "PHONE", "URL", "ADDRESS", "DATE", "TIME"].includes(field.type)) {
    if (typeof value !== "string") return false;
    if (field.type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) return false;
    if (field.type === "PHONE" && !/^\+?[0-9 ()-]{7,30}$/u.test(value)) return false;
    if (field.type === "URL") {
      try {
        const url = new URL(value);
        if (!/^https?:$/u.test(url.protocol)) return false;
      } catch {
        return false;
      }
    }
    if (field.type === "DATE" && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    if (field.type === "TIME" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) return false;
    if (field.minimum !== undefined && value.length < field.minimum) return false;
    if (field.maximum !== undefined && value.length > field.maximum) return false;
    return true;
  }
  if (field.type === "NUMBER" || field.type === "SCALE" || field.type === "RATING") {
    return (
      typeof value === "number" &&
      (field.minimum === undefined || value >= field.minimum) &&
      (field.maximum === undefined || value <= field.maximum)
    );
  }
  if (field.type === "CHECKBOX") return typeof value === "boolean";
  if (field.type === "MULTIPLE_CHOICE") {
    return Array.isArray(value) && value.every((entry) => field.options.includes(entry));
  }
  return typeof value === "string" && field.options.includes(value);
}

export function validateFormAnswers(
  definition: FormDefinition,
  answers: Readonly<Record<string, FormAnswerValue>>,
  pendingImageFieldIds: readonly string[] = [],
): Readonly<Record<string, FormAnswerValue>> {
  const accepted: Record<string, FormAnswerValue> = {};
  const fields = definition.sections.flatMap((section) => section.fields);
  for (const key of Object.keys(answers)) {
    if (!fields.some((field) => field.id === key)) throw new FormValidationError("Unknown field");
  }
  for (const field of fields) {
    if (!isFormFieldVisible(field, { ...answers, ...accepted })) continue;
    const value = answers[field.id];
    const empty =
      value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) {
      if (field.type === "IMAGE_UPLOAD" && field.required && pendingImageFieldIds.includes(field.id)) {
        continue;
      }
      if (field.required) throw new FormValidationError(`Required field: ${field.label}`);
      continue;
    }
    if (!validFor(field, value)) throw new FormValidationError(`Invalid field: ${field.label}`);
    accepted[field.id] = value;
  }
  return Object.freeze(accepted);
}

export class FormService {
  public constructor(
    private readonly repository: FormRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public list(permissions: readonly IamPermission[]) {
    allow(permissions, "crm:forms:read");
    return this.repository.list();
  }

  public async find(permissions: readonly IamPermission[], id: string) {
    allow(permissions, "crm:forms:read");
    const form = await this.repository.find(id);
    if (!form) throw new FormNotFoundError();
    return form;
  }

  public create(input: {
    readonly memberId: string;
    readonly permissions: readonly IamPermission[];
    readonly title: string;
    readonly description: string;
    readonly definition: FormDefinition;
    readonly theme: FormTheme;
    readonly closesAt: Date | null;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:forms:write");
    const now = this.clock();
    if (input.closesAt && input.closesAt <= now) throw new FormValidationError();
    const form: FormRecord = Object.freeze({
      id: randomUUID(),
      slug: slug(input.title),
      title: input.title.trim(),
      description: input.description.trim(),
      status: "DRAFT",
      definition: input.definition,
      theme: input.theme,
      publishedRevision: null,
      closesAt: input.closesAt,
      version: 1n,
      createdAt: now,
      updatedAt: now,
    });
    return this.repository.create({
      form,
      actorMemberId: input.memberId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }

  public async update(input: {
    readonly memberId: string;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly patch: Partial<
      Pick<FormRecord, "title" | "description" | "definition" | "theme" | "closesAt">
    >;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:forms:write");
    const result = await this.repository.update({
      ...input,
      actorMemberId: input.memberId,
      now: this.clock(),
    });
    if (!result) throw new FormVersionConflictError();
    return result;
  }

  public async publish(input: {
    readonly memberId: string;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:forms:publish");
    const result = await this.repository.publish({
      ...input,
      actorMemberId: input.memberId,
      now: this.clock(),
    });
    if (!result) throw new FormVersionConflictError();
    return result;
  }

  public async close(input: {
    readonly memberId: string;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:forms:publish");
    const result = await this.repository.close({
      ...input,
      actorMemberId: input.memberId,
      now: this.clock(),
    });
    if (!result) throw new FormVersionConflictError();
    return result;
  }

  public async publicForm(slugValue: string) {
    const published = await this.repository.findPublishedBySlug(slugValue);
    if (!published) throw new FormNotFoundError();
    if (
      published.form.status !== "PUBLISHED" ||
      (published.form.closesAt && published.form.closesAt <= this.clock())
    ) {
      throw new FormClosedError();
    }
    return published;
  }

  public async submit(input: {
    readonly slug: string;
    readonly answers: Readonly<Record<string, FormAnswerValue>>;
    readonly pendingImageFieldIds?: readonly string[];
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    const published = await this.publicForm(input.slug);
    const submittedAt = this.clock();
    const answers = validateFormAnswers(
      published.definition,
      input.answers,
      input.pendingImageFieldIds ?? [],
    );
    return this.repository.submit({
      submission: Object.freeze({
        id: randomUUID(),
        formId: published.form.id,
        formRevision: published.revision,
        contactId: null,
        answers,
        submittedAt,
      }),
      slug: input.slug,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      now: submittedAt,
    });
  }

  public async responses(input: {
    readonly permissions: readonly IamPermission[];
    readonly formId: string;
    readonly from?: Date;
    readonly to?: Date;
    readonly limit: number;
  }) {
    allow(input.permissions, "crm:forms:responses");
    if (!(await this.repository.find(input.formId))) throw new FormNotFoundError();
    return this.repository.responses(input.formId, input);
  }

  public async publicResponseUpload(slugValue: string, responseId: string) {
    const upload = await this.repository.findPublicResponseUpload(slugValue, responseId, this.clock());
    if (!upload) throw new FormNotFoundError();
    return upload;
  }

  public async appendPublicResponseImage(input: {
    readonly slug: string;
    readonly responseId: string;
    readonly fieldId: string;
    readonly fileId: string;
  }) {
    const upload = await this.publicResponseUpload(input.slug, input.responseId);
    const field = upload.definition.sections
      .flatMap((section) => section.fields)
      .find((candidate) => candidate.id === input.fieldId);
    if (!field || field.type !== "IMAGE_UPLOAD") throw new FormValidationError("Invalid image field");
    const updated = await this.repository.appendResponseImage(input);
    if (!updated) throw new FormNotFoundError();
    return updated;
  }
}
