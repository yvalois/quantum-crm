import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
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
  CreateDocumentSchema,
  CreateDocumentTemplateSchema,
  DocumentListQuerySchema,
  DocumentListResponseSchema,
  DocumentResponseSchema,
  DocumentTemplateListResponseSchema,
  DocumentTemplateResponseSchema,
  DuplicateDocumentSchema,
  UpdateDocumentSchema,
  UpdateDocumentTemplateSchema,
} from "@quantum-crm/contracts";
import {
  DocumentNotFoundError,
  DocumentService,
  DocumentValidationError,
  DocumentVersionConflictError,
  IamAuthorizationError,
  type CommercialActor,
  type CommercialDocumentRecord,
  type DocumentTemplateRecord,
  type IamPermission,
} from "@quantum-crm/domain";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const DOCUMENT_SERVICE = Symbol("DOCUMENT_SERVICE");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

function key(value: string | undefined): string {
  if (!value || !keyPattern.test(value)) throw new BadRequestException();
  return value;
}

function version(value: string | undefined): bigint {
  const match = typeof value === "string" ? /^"([1-9][0-9]*)"$/u.exec(value) : null;
  if (!match?.[1])
    throw new HttpException("If-Match is required", HttpStatus.PRECONDITION_REQUIRED);
  return BigInt(match[1]);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function identity(request: Parameters<typeof crmAuthContext>[0]): {
  readonly actor: CommercialActor;
  readonly permissions: readonly IamPermission[];
} {
  const context = crmAuthContext(request);
  return Object.freeze({
    actor: Object.freeze({ memberId: context.principal.id, scope: context.commercialScope }),
    permissions: context.permissions as readonly IamPermission[],
  });
}

function document(record: CommercialDocumentRecord) {
  return {
    ...record,
    version: record.version.toString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function template(record: DocumentTemplateRecord) {
  return {
    ...record,
    version: record.version.toString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function map(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof DocumentNotFoundError) throw new NotFoundException();
  if (error instanceof DocumentVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof CommercialIdempotencyConflictError) throw new ConflictException();
  if (error instanceof DocumentValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/documents")
export class DocumentsController {
  public constructor(@Inject(DOCUMENT_SERVICE) private readonly service: DocumentService) {}

  @Get()
  @RequireCrmPermission("crm:documents:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0], @Query() query: unknown) {
    try {
      const parsed = DocumentListQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const filters = {
        ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.contactId === undefined ? {} : { contactId: parsed.data.contactId }),
      };
      return DocumentListResponseSchema.parse({
        data: (await this.service.list(auth.actor, auth.permissions, filters)).map(document),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post()
  @RequireCrmPermission("crm:documents:create")
  public async create(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateDocumentSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      return DocumentResponseSchema.parse({
        data: document(
          await this.service.create({
            ...auth,
            kind: parsed.data.kind,
            title: parsed.data.title,
            contactId: parsed.data.contactId ?? null,
            opportunityId: parsed.data.opportunityId ?? null,
            templateId: parsed.data.templateId ?? null,
            ...(parsed.data.blocks === undefined ? {} : { blocks: parsed.data.blocks }),
            ...(parsed.data.design === undefined ? {} : { design: parsed.data.design }),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(parsed.data),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("templates")
  @RequireCrmPermission("crm:documents:read")
  public async templates(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query("kind") kind: unknown,
  ) {
    try {
      const parsed = DocumentListQuerySchema.pick({ kind: true }).safeParse(
        kind === undefined ? {} : { kind },
      );
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      return DocumentTemplateListResponseSchema.parse({
        data: (await this.service.listTemplates(auth.permissions, parsed.data.kind)).map(template),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("templates")
  @RequireCrmPermission("crm:documents:templates")
  public async createTemplate(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateDocumentTemplateSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      return DocumentTemplateResponseSchema.parse({
        data: template(
          await this.service.createTemplate({
            ...auth,
            ...parsed.data,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(parsed.data),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Patch("templates/:templateId")
  @RequireCrmPermission("crm:documents:templates")
  public async updateTemplate(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("templateId") templateId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(templateId)) throw new BadRequestException();
    try {
      const parsed = UpdateDocumentTemplateSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const expectedVersion = version(ifMatch);
      const patch = {
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.blocks === undefined ? {} : { blocks: parsed.data.blocks }),
        ...(parsed.data.design === undefined ? {} : { design: parsed.data.design }),
      };
      return DocumentTemplateResponseSchema.parse({
        data: template(
          await this.service.updateTemplate({
            ...auth,
            id: templateId,
            expectedVersion,
            patch,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              templateId,
              expectedVersion: expectedVersion.toString(),
              ...parsed.data,
            }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get(":documentId")
  @RequireCrmPermission("crm:documents:read")
  public async get(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("documentId") documentId: string,
  ) {
    if (!uuidPattern.test(documentId)) throw new BadRequestException();
    try {
      const auth = identity(request);
      return DocumentResponseSchema.parse({
        data: document(await this.service.get(auth.actor, auth.permissions, documentId)),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Patch(":documentId")
  @RequireCrmPermission("crm:documents:update")
  public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("documentId") documentId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(documentId)) throw new BadRequestException();
    try {
      const parsed = UpdateDocumentSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const expectedVersion = version(ifMatch);
      const patch = {
        ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
        ...(parsed.data.contactId === undefined ? {} : { contactId: parsed.data.contactId }),
        ...(parsed.data.opportunityId === undefined
          ? {}
          : { opportunityId: parsed.data.opportunityId }),
        ...(parsed.data.blocks === undefined ? {} : { blocks: parsed.data.blocks }),
        ...(parsed.data.design === undefined ? {} : { design: parsed.data.design }),
      };
      return DocumentResponseSchema.parse({
        data: document(
          await this.service.update({
            ...auth,
            id: documentId,
            expectedVersion,
            patch,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              documentId,
              expectedVersion: expectedVersion.toString(),
              ...parsed.data,
            }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post(":documentId/duplicate")
  @RequireCrmPermission("crm:documents:create")
  public async duplicate(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("documentId") documentId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(documentId)) throw new BadRequestException();
    try {
      const parsed = DuplicateDocumentSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      return DocumentResponseSchema.parse({
        data: document(
          await this.service.duplicate({
            ...auth,
            sourceId: documentId,
            ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({ documentId, ...parsed.data }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
}
