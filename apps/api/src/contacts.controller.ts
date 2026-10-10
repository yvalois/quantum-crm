import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  PreconditionFailedException,
  Query,
  Req,
} from "@nestjs/common";
import {
  ContactBulkActionResponseSchema,
  ContactBulkActionSchema,
  ContactIdSchema,
  ContactImportApplyResponseSchema,
  ContactImportFileSchema,
  ContactImportPreviewResponseSchema,
  ContactListQuerySchema,
  ContactListResponseSchema,
  ContactLabelListResponseSchema,
  ContactLabelResponseSchema,
  ContactResponseSchema,
  CreateContactLabelSchema,
  CreateContactSchema,
  UpdateContactSchema,
} from "@quantum-crm/contracts";
import {
  ContactNotFoundError,
  ContactService,
  ContactValidationError,
  ContactVersionConflictError,
  IamAuthorizationError,
  type CommercialActor,
  type ContactImportPreviewRow,
  type ContactListFilters,
  type IamPermission,
} from "@quantum-crm/domain";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";
import { ContactImportFileError, parseContactImportFile } from "./contact-import-file.js";

export const CONTACT_SERVICE = Symbol("CONTACT_SERVICE");
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
function payloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function expectedVersion(value: string | undefined): bigint {
  const match = typeof value === "string" ? /^"([1-9][0-9]*)"$/u.exec(value) : null;
  if (!match?.[1])
    throw new HttpException("If-Match is required", HttpStatus.PRECONDITION_REQUIRED);
  return BigInt(match[1]);
}
function actor(request: Parameters<typeof crmAuthContext>[0]): {
  readonly actor: CommercialActor;
  readonly permissions: readonly IamPermission[];
} {
  const context = crmAuthContext(request);
  const permissions = context.permissions as readonly IamPermission[];
  return Object.freeze({
    actor: Object.freeze({ memberId: context.principal.id, scope: context.commercialScope }),
    permissions,
  });
}
function contactResponse(contact: {
  readonly id: string;
  readonly ownerMemberId: string | null;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly labels: readonly { readonly id: string; readonly name: string }[];
  readonly source: "MANUAL" | "IMPORT" | "FORM" | "CONVERSATION" | "API" | "MIGRATION" | "OTHER";
  readonly archivedAt: Date | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return ContactResponseSchema.parse({
    data: {
      id: contact.id,
      ownerMemberId: contact.ownerMemberId,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      labels: contact.labels,
      source: contact.source,
      archivedAt: contact.archivedAt?.toISOString() ?? null,
      version: contact.version.toString(),
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    },
  });
}
function mapError(error: unknown): never {
  if (error instanceof Error && error.name === "ZodError") throw new BadRequestException();
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof ContactNotFoundError) throw new NotFoundException();
  if (error instanceof ContactVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof CommercialIdempotencyConflictError) throw new ConflictException();
  if (error instanceof ContactValidationError) throw new BadRequestException();
  if (error instanceof ContactImportFileError) throw new BadRequestException();
  throw error;
}

function importPreviewResponse(rows: readonly ContactImportPreviewRow[]) {
  const validRows = rows.filter((row) => row.status !== "ERROR").length;
  const errorRows = rows.length - validRows;
  const matches = rows.filter((row) => row.status === "MATCH").length;
  return ContactImportPreviewResponseSchema.parse({
    data: { rows, validRows, errorRows, matches },
  });
}

interface ContactCursorPayload {
  readonly v: 1;
  readonly fingerprint: string;
  readonly direction: "NEXT" | "PREVIOUS";
  readonly value: string;
  readonly id: string;
}

function paginationScope(
  filters: ContactListFilters,
): Omit<ContactListFilters, "cursor" | "limit"> {
  return Object.freeze({
    ...(filters.q === undefined ? {} : { q: filters.q }),
    ...(filters.label === undefined ? {} : { label: filters.label }),
    ...(filters.pipelineId === undefined ? {} : { pipelineId: filters.pipelineId }),
    ...(filters.ownerMemberId === undefined ? {} : { ownerMemberId: filters.ownerMemberId }),
    ...(filters.channel === undefined ? {} : { channel: filters.channel }),
    ...(filters.source === undefined ? {} : { source: filters.source }),
    ...(filters.archived === undefined ? {} : { archived: filters.archived }),
    ...(filters.assignment === undefined ? {} : { assignment: filters.assignment }),
    ...(filters.createdFrom === undefined ? {} : { createdFrom: filters.createdFrom }),
    ...(filters.createdTo === undefined ? {} : { createdTo: filters.createdTo }),
    ...(filters.sort === undefined ? {} : { sort: filters.sort }),
  });
}

function cursorFingerprint(
  actor: CommercialActor,
  filters: Omit<ContactListFilters, "cursor" | "limit">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actorMemberId: actor.memberId,
        scope: actor.scope,
        filters: {
          q: filters.q,
          label: filters.label,
          pipelineId: filters.pipelineId,
          ownerMemberId: filters.ownerMemberId,
          channel: filters.channel,
          source: filters.source,
          archived: filters.archived,
          assignment: filters.assignment,
          createdFrom: filters.createdFrom?.toISOString(),
          createdTo: filters.createdTo?.toISOString(),
          sort: filters.sort,
        },
      }),
    )
    .digest("base64url");
}

function decodeCursor(
  value: string,
  actor: CommercialActor,
  filters: Omit<ContactListFilters, "cursor" | "limit">,
): NonNullable<ContactListFilters["cursor"]> {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ContactCursorPayload>;
    if (
      parsed.v !== 1 ||
      (parsed.direction !== "NEXT" && parsed.direction !== "PREVIOUS") ||
      typeof parsed.value !== "string" ||
      parsed.value.length < 1 ||
      parsed.value.length > 160 ||
      typeof parsed.id !== "string" ||
      ContactIdSchema.safeParse(parsed.id).success === false ||
      parsed.fingerprint !== cursorFingerprint(actor, filters)
    ) {
      throw new Error("invalid cursor");
    }
    if (
      filters.sort !== "NAME_ASC" &&
      (Number.isNaN(Date.parse(parsed.value)) ||
        new Date(parsed.value).toISOString() !== parsed.value)
    ) {
      throw new Error("invalid cursor timestamp");
    }
    return Object.freeze({ direction: parsed.direction, value: parsed.value, id: parsed.id });
  } catch {
    throw new BadRequestException();
  }
}

function encodeCursor(
  actor: CommercialActor,
  filters: Omit<ContactListFilters, "cursor" | "limit">,
  direction: "NEXT" | "PREVIOUS",
  contact: Parameters<typeof contactResponse>[0],
): string {
  const value =
    filters.sort === "CREATED_DESC"
      ? contact.createdAt.toISOString()
      : filters.sort === "NAME_ASC"
        ? contact.displayName.toLowerCase()
        : contact.updatedAt.toISOString();
  const payload: ContactCursorPayload = {
    v: 1,
    fingerprint: cursorFingerprint(actor, filters),
    direction,
    value,
    id: contact.id,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function contactFilters(
  query: Record<string, unknown>,
  actor: CommercialActor,
): ContactListFilters {
  const parsed = ContactListQuerySchema.safeParse(query);
  if (!parsed.success) throw new BadRequestException();
  const filters: Omit<ContactListFilters, "cursor"> = {
    ...(parsed.data.q === undefined ? {} : { q: parsed.data.q }),
    limit: parsed.data.limit,
    sort: parsed.data.sort,
    ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
    ...(parsed.data.pipelineId === undefined ? {} : { pipelineId: parsed.data.pipelineId }),
    ...(parsed.data.ownerMemberId === undefined
      ? {}
      : { ownerMemberId: parsed.data.ownerMemberId }),
    ...(parsed.data.channel === undefined ? {} : { channel: parsed.data.channel }),
    ...(parsed.data.source === undefined ? {} : { source: parsed.data.source }),
    archived: parsed.data.archived,
    ...(parsed.data.assignment === undefined ? {} : { assignment: parsed.data.assignment }),
    ...(parsed.data.createdFrom === undefined
      ? {}
      : { createdFrom: new Date(parsed.data.createdFrom) }),
    ...(parsed.data.createdTo === undefined ? {} : { createdTo: new Date(parsed.data.createdTo) }),
  };
  if (parsed.data.cursor === undefined) return Object.freeze(filters);
  return Object.freeze({
    ...filters,
    cursor: decodeCursor(parsed.data.cursor, actor, paginationScope(filters)),
  });
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

@Controller("api/v1/contacts")
export class ContactsController {
  public constructor(@Inject(CONTACT_SERVICE) private readonly service: ContactService) {}

  @Get("labels")
  @RequireCrmPermission("crm:contacts:read")
  public async listLabels(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      const identity = actor(request);
      return ContactLabelListResponseSchema.parse({
        data: await this.service.listLabels(identity.actor, identity.permissions),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Post("labels")
  @RequireCrmPermission("crm:contacts:update")
  public async createLabel(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
      throw new BadRequestException();
    try {
      const payload = CreateContactLabelSchema.parse(body);
      const identity = actor(request);
      return ContactLabelResponseSchema.parse({
        data: await this.service.createLabel({
          ...identity,
          name: payload.name,
          idempotencyKey,
          payloadHash: payloadHash(payload),
        }),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Post("actions")
  @RequireCrmPermission("crm:contacts:read")
  public async bulk(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
      throw new BadRequestException();
    try {
      const payload = ContactBulkActionSchema.parse(body);
      const identity = actor(request);
      return ContactBulkActionResponseSchema.parse({
        data: await this.service.bulk({
          ...identity,
          action: payload,
          idempotencyKey,
          payloadHash: payloadHash(payload),
        }),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Get()
  @RequireCrmPermission("crm:contacts:read")
  public async list(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query() query: Record<string, unknown>,
  ) {
    try {
      const identity = actor(request);
      const filters = contactFilters(query, identity.actor);
      const contacts = await this.service.listPage(identity.actor, identity.permissions, filters);
      const first = contacts.records[0];
      const last = contacts.records.at(-1);
      const requestedDirection = filters.cursor?.direction ?? "NEXT";
      const cursorFilters = paginationScope(filters);
      return ContactListResponseSchema.parse({
        data: contacts.records.map((contact) => contactResponse(contact).data),
        page: {
          limit: filters.limit ?? 50,
          nextCursor:
            last === undefined
              ? null
              : requestedDirection === "NEXT"
                ? contacts.hasMoreInRequestedDirection
                  ? encodeCursor(identity.actor, cursorFilters, "NEXT", last)
                  : null
                : encodeCursor(identity.actor, cursorFilters, "NEXT", last),
          previousCursor:
            first === undefined
              ? null
              : requestedDirection === "PREVIOUS"
                ? contacts.hasMoreInRequestedDirection
                  ? encodeCursor(identity.actor, cursorFilters, "PREVIOUS", first)
                  : null
                : filters.cursor === undefined
                  ? null
                  : encodeCursor(identity.actor, cursorFilters, "PREVIOUS", first),
          total: contacts.total,
        },
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Post()
  @RequireCrmPermission("crm:contacts:create")
  public async create(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
      throw new BadRequestException();
    try {
      const payload = CreateContactSchema.parse(body);
      const identity = actor(request);
      return contactResponse(
        await this.service.create({
          ...identity,
          displayName: payload.displayName,
          ...(payload.email === undefined ? {} : { email: payload.email }),
          ...(payload.phone === undefined ? {} : { phone: payload.phone }),
          ...(payload.ownerMemberId === undefined ? {} : { ownerMemberId: payload.ownerMemberId }),
          ...(payload.source === undefined ? {} : { source: payload.source }),
          ...(payload.labelIds === undefined ? {} : { labelIds: payload.labelIds }),
          idempotencyKey,
          payloadHash: payloadHash(payload),
        }),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @Post("import/preview")
  @RequireCrmPermission("crm:contacts:read")
  public async importPreview(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Body() body: unknown,
  ) {
    try {
      const payload = ContactImportFileSchema.parse(body);
      const rows = parseContactImportFile(payload);
      const identity = actor(request);
      return importPreviewResponse(
        await this.service.previewImport(identity.actor, identity.permissions, rows),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @Post("import")
  @RequireCrmPermission("crm:contacts:create")
  public async importContacts(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
      throw new BadRequestException();
    try {
      const payload = ContactImportFileSchema.parse(body);
      const rows = parseContactImportFile(payload);
      const identity = actor(request);
      const result = await this.service.importRows({
        ...identity,
        rows,
        operationKey: idempotencyKey,
        payloadHash: payloadHash(payload),
      });
      return ContactImportApplyResponseSchema.parse({ data: result });
    } catch (error) {
      return mapError(error);
    }
  }

  @Get("export")
  @RequireCrmPermission("crm:contacts:export")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="contacts.csv"')
  public async exportContacts(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query() query: Record<string, unknown>,
  ) {
    try {
      const identity = actor(request);
      const contacts = await this.service.exportRows(
        identity.actor,
        identity.permissions,
        contactFilters(query, identity.actor),
      );
      const lines = ["displayName,email,phone,ownerMemberId,labels,source,archivedAt"];
      for (const contact of contacts) {
        lines.push(
          [
            contact.displayName,
            contact.email,
            contact.phone,
            contact.ownerMemberId,
            contact.labels.map((label) => label.name).join("; "),
            contact.source,
            contact.archivedAt?.toISOString() ?? null,
          ]
            .map(csvCell)
            .join(","),
        );
      }
      return `${lines.join("\r\n")}\r\n`;
    } catch (error) {
      return mapError(error);
    }
  }

  @Get(":contactId")
  @RequireCrmPermission("crm:contacts:read")
  public async get(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("contactId") contactId: string,
  ) {
    try {
      const identity = actor(request);
      return contactResponse(
        await this.service.get(
          identity.actor,
          identity.permissions,
          ContactIdSchema.parse(contactId),
        ),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @Patch(":contactId")
  @RequireCrmPermission("crm:contacts:update")
  public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("contactId") contactId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const payload = UpdateContactSchema.parse(body);
      const identity = actor(request);
      return contactResponse(
        await this.service.update({
          ...identity,
          id: ContactIdSchema.parse(contactId),
          ...(payload.displayName === undefined ? {} : { displayName: payload.displayName }),
          ...(payload.email === undefined ? {} : { email: payload.email }),
          ...(payload.phone === undefined ? {} : { phone: payload.phone }),
          expectedVersion: expectedVersion(ifMatch),
        }),
      );
    } catch (error) {
      return mapError(error);
    }
  }
}
