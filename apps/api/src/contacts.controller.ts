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
  Req,
} from "@nestjs/common";
import {
  ContactIdSchema,
  ContactImportApplyResponseSchema,
  ContactImportFileSchema,
  ContactImportPreviewResponseSchema,
  ContactListResponseSchema,
  ContactResponseSchema,
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
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return ContactResponseSchema.parse({
    data: {
      id: contact.id,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      version: contact.version.toString(),
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    },
  });
}
function mapError(error: unknown): never {
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

function csvCell(value: string | null): string {
  const text = value ?? "";
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

@Controller("api/v1/contacts")
export class ContactsController {
  public constructor(@Inject(CONTACT_SERVICE) private readonly service: ContactService) {}

  @Get()
  @RequireCrmPermission("crm:contacts:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      const identity = actor(request);
      const contacts = await this.service.list(identity.actor, identity.permissions);
      return ContactListResponseSchema.parse({
        data: contacts.map((contact) => contactResponse(contact).data),
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
  public async exportContacts(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      const identity = actor(request);
      const contacts = await this.service.exportRows(identity.actor, identity.permissions);
      const lines = ["displayName,email,phone"];
      for (const contact of contacts) {
        lines.push([contact.displayName, contact.email, contact.phone].map(csvCell).join(","));
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
