import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  Headers,
  HttpCode,
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
  CloseFormSchema,
  CompleteFileUploadSchema,
  CreateFormSchema,
  FileOperationResponseSchema,
  FileResponseSchema,
  FileUploadIntentResponseSchema,
  FormListResponseSchema,
  FormResponseListQuerySchema,
  FormResponseSchema,
  PublicFormResponseSchema,
  PublicFormImageUploadIntentSchema,
  PublishFormSchema,
  SubmitFormResponseSchema,
  SubmittedFormResponseListSchema,
  SubmittedFormResponseResponseSchema,
  UpdateFormSchema,
} from "@quantum-crm/contracts";
import {
  FormClosedError,
  FormNotFoundError,
  type FormRecord,
  FormService,
  FormValidationError,
  FormVersionConflictError,
  FileService,
  FileStateConflictError,
  IamAuthorizationError,
  type IamPermission,
  type SubmittedFormRecord,
} from "@quantum-crm/domain";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";

import { CrmPublicRoute, crmAuthContext, RequireCrmPermission } from "./crm-security.js";
import { FILE_SERVICE } from "./files.controller.js";

export const FORM_SERVICE = Symbol("FORM_SERVICE");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{8}$/u;
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
function permissions(request: Parameters<typeof crmAuthContext>[0]) {
  const context = crmAuthContext(request);
  return {
    memberId: context.principal.id,
    permissions: context.permissions as readonly IamPermission[],
  };
}
function output(record: FormRecord) {
  return {
    ...record,
    closesAt: record.closesAt?.toISOString() ?? null,
    version: record.version.toString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
function response(record: SubmittedFormRecord) {
  return { ...record, submittedAt: record.submittedAt.toISOString() };
}
function publicFile(record: Awaited<ReturnType<FileService["get"]>>) {
  return {
    id: record.id,
    status: record.status,
    fileClass: record.fileClass,
    name: record.originalName,
    mimeType: record.observedMime ?? record.declaredMime,
    size: record.observedSize ?? record.declaredSize,
    sha256: record.observedSha256 ?? record.expectedSha256,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
const publicFilePermissions: readonly IamPermission[] = [
  "crm:files:read",
  "crm:files:upload",
  "crm:files:reference",
];
function publicFileActor(responseId: string) {
  return { memberId: responseId, scope: "PROFILE" as const };
}
function map(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof FormNotFoundError) throw new NotFoundException();
  if (error instanceof FormClosedError) throw new GoneException();
  if (error instanceof FormValidationError) throw new BadRequestException(error.message);
  if (error instanceof FormVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof FileStateConflictError) throw new ConflictException();
  if (error instanceof CommercialIdempotencyConflictError) throw new ConflictException();
  throw error;
}

@Controller("api/v1/forms")
export class FormsController {
  public constructor(
    @Inject(FORM_SERVICE) private readonly service: FormService,
    @Inject(FILE_SERVICE) private readonly files: FileService,
  ) {}

  private async imageUpload(slug: string, responseId: string, fieldId: string) {
    const upload = await this.service.publicResponseUpload(slug, responseId);
    const field = upload.definition.sections
      .flatMap((section) => section.fields)
      .find((candidate) => candidate.id === fieldId);
    if (!field || field.type !== "IMAGE_UPLOAD") throw new FormValidationError("Invalid image field");
    return upload;
  }

  @Get()
  @RequireCrmPermission("crm:forms:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      return FormListResponseSchema.parse({
        data: (await this.service.list(permissions(request).permissions)).map(output),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post()
  @RequireCrmPermission("crm:forms:write")
  public async create(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateFormSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const identity = permissions(request);
      return FormResponseSchema.parse({
        data: output(
          await this.service.create({
            ...identity,
            ...parsed.data,
            closesAt: parsed.data.closesAt ? new Date(parsed.data.closesAt) : null,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(parsed.data),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get(":formId")
  @RequireCrmPermission("crm:forms:read")
  public async find(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("formId") formId: string,
  ) {
    if (!uuidPattern.test(formId)) throw new BadRequestException();
    try {
      return FormResponseSchema.parse({
        data: output(await this.service.find(permissions(request).permissions, formId)),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Patch(":formId")
  @RequireCrmPermission("crm:forms:write")
  public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("formId") formId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(formId)) throw new BadRequestException();
    try {
      const parsed = UpdateFormSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const identity = permissions(request);
      const patch: Partial<
        Pick<FormRecord, "title" | "description" | "definition" | "theme" | "closesAt">
      > = {
        ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
        ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
        ...(parsed.data.definition === undefined ? {} : { definition: parsed.data.definition }),
        ...(parsed.data.theme === undefined ? {} : { theme: parsed.data.theme }),
        ...(parsed.data.closesAt === undefined
          ? {}
          : { closesAt: parsed.data.closesAt ? new Date(parsed.data.closesAt) : null }),
      };
      return FormResponseSchema.parse({
        data: output(
          await this.service.update({
            ...identity,
            id: formId,
            expectedVersion: version(ifMatch),
            patch,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({ formId, ...parsed.data, ifMatch }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post(":formId/publish")
  @RequireCrmPermission("crm:forms:publish")
  public async publish(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("formId") formId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(formId) || !PublishFormSchema.safeParse(body).success)
      throw new BadRequestException();
    try {
      return FormResponseSchema.parse({
        data: output(
          await this.service.publish({
            ...permissions(request),
            id: formId,
            expectedVersion: version(ifMatch),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({ formId, ifMatch }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post(":formId/close")
  @RequireCrmPermission("crm:forms:publish")
  public async close(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("formId") formId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(formId) || !CloseFormSchema.safeParse(body).success)
      throw new BadRequestException();
    try {
      return FormResponseSchema.parse({
        data: output(
          await this.service.close({
            ...permissions(request),
            id: formId,
            expectedVersion: version(ifMatch),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({ formId, ifMatch }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get(":formId/responses")
  @RequireCrmPermission("crm:forms:responses")
  public async responses(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("formId") formId: string,
    @Query() query: unknown,
  ) {
    if (!uuidPattern.test(formId)) throw new BadRequestException();
    try {
      const parsed = FormResponseListQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      return SubmittedFormResponseListSchema.parse({
        data: (
          await this.service.responses({
            permissions: permissions(request).permissions,
            formId,
            limit: parsed.data.limit,
            ...(parsed.data.from ? { from: new Date(parsed.data.from) } : {}),
            ...(parsed.data.to ? { to: new Date(parsed.data.to) } : {}),
          })
        ).map(response),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("public/:slug")
  @CrmPublicRoute()
  public async publicForm(@Param("slug") slug: string) {
    if (!slugPattern.test(slug)) throw new BadRequestException();
    try {
      const published = await this.service.publicForm(slug);
      return PublicFormResponseSchema.parse({
        data: {
          ...output(published.form),
          definition: published.definition,
          theme: published.theme,
          publishedRevision: published.revision,
        },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("public/:slug/responses")
  @CrmPublicRoute()
  public async submit(
    @Param("slug") slug: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!slugPattern.test(slug)) throw new BadRequestException();
    try {
      const parsed = SubmitFormResponseSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      return SubmittedFormResponseResponseSchema.parse({
        data: response(
          await this.service.submit({
            slug,
            answers: parsed.data.answers,
            pendingImageFieldIds: parsed.data.pendingImageFieldIds,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(parsed.data),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("public/:slug/responses/:responseId/image-upload-intents")
  @CrmPublicRoute()
  public async reservePublicImage(
    @Param("slug") slug: string,
    @Param("responseId") responseId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!slugPattern.test(slug) || !uuidPattern.test(responseId)) throw new BadRequestException();
    try {
      const parsed = PublicFormImageUploadIntentSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      await this.imageUpload(slug, responseId, parsed.data.fieldId);
      const reserved = await this.files.reserveUpload({
        actor: publicFileActor(responseId),
        permissions: publicFilePermissions,
        owner: { kind: "existing", module: "forms", type: "form_response", id: responseId },
        fileClass: "IMAGE",
        ...parsed.data,
        idempotencyKey: key(idempotencyKey),
        payloadHash: hash(parsed.data),
      });
      return FileUploadIntentResponseSchema.parse({
        data: {
          file: publicFile(reserved.file),
          upload: { ...reserved.upload, expiresAt: reserved.upload.expiresAt.toISOString() },
        },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("public/:slug/responses/:responseId/files/:fileId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  @CrmPublicRoute()
  public async completePublicImage(
    @Param("slug") slug: string,
    @Param("responseId") responseId: string,
    @Param("fileId") fileId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!slugPattern.test(slug) || !uuidPattern.test(responseId) || !uuidPattern.test(fileId))
      throw new BadRequestException();
    try {
      const parsed = CompleteFileUploadSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      await this.service.publicResponseUpload(slug, responseId);
      const completed = await this.files.completeUpload({
        actor: publicFileActor(responseId),
        permissions: publicFilePermissions,
        fileId,
        checksum: parsed.data.checksum,
        ...(parsed.data.versionId ? { versionId: parsed.data.versionId } : {}),
        ...(parsed.data.receipt ? { receipt: parsed.data.receipt } : {}),
        idempotencyKey: key(idempotencyKey),
        payloadHash: hash({ fileId, ...parsed.data }),
      });
      return FileOperationResponseSchema.parse({
        data: {
          ...completed.operation,
          createdAt: completed.operation.createdAt.toISOString(),
          updatedAt: completed.operation.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("public/:slug/responses/:responseId/files/:fileId")
  @CrmPublicRoute()
  public async publicImageStatus(
    @Param("slug") slug: string,
    @Param("responseId") responseId: string,
    @Param("fileId") fileId: string,
  ) {
    if (!slugPattern.test(slug) || !uuidPattern.test(responseId) || !uuidPattern.test(fileId))
      throw new BadRequestException();
    try {
      await this.service.publicResponseUpload(slug, responseId);
      return FileResponseSchema.parse({
        data: publicFile(await this.files.get(publicFileActor(responseId), publicFilePermissions, fileId)),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("public/:slug/responses/:responseId/image-fields/:fieldId/files/:fileId")
  @CrmPublicRoute()
  public async attachPublicImage(
    @Param("slug") slug: string,
    @Param("responseId") responseId: string,
    @Param("fieldId") fieldId: string,
    @Param("fileId") fileId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    if (![responseId, fieldId, fileId].every((value) => uuidPattern.test(value)) || !slugPattern.test(slug))
      throw new BadRequestException();
    try {
      await this.imageUpload(slug, responseId, fieldId);
      const actor = publicFileActor(responseId);
      const file = await this.files.get(actor, publicFilePermissions, fileId);
      if (file.status !== "AVAILABLE") throw new FileStateConflictError();
      const operationKey = hash({ responseId, fieldId, fileId, idempotencyKey: key(idempotencyKey) });
      await this.files.attachReference({
        actor,
        permissions: publicFilePermissions,
        fileId,
        owner: { kind: "existing", module: "forms", type: "form_response", id: responseId },
        kind: "ATTACHMENT",
        idempotencyKey: operationKey,
        payloadHash: operationKey,
      });
      return SubmittedFormResponseResponseSchema.parse({
        data: response(
          await this.service.appendPublicResponseImage({ slug, responseId, fieldId, fileId }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
}
