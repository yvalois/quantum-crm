import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  CompleteFileUploadSchema,
  CreateFileReferenceSchema,
  CreateFileUploadIntentSchema,
  FileDownloadAuthorizationResponseSchema,
  FileIdSchema,
  FileListQuerySchema,
  FileListResponseSchema,
  FileOperationResponseSchema,
  FileReferenceResponseSchema,
  FileResponseSchema,
  FileUploadIntentResponseSchema,
} from "@quantum-crm/contracts";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";
import {
  FileNotFoundError,
  type FileListFilters,
  type FileRecord,
  type FileReferenceRecord,
  FileService,
  FileStateConflictError,
  FileValidationError,
  IamAuthorizationError,
  type CommercialActor,
  type IamPermission,
} from "@quantum-crm/domain";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const FILE_SERVICE = Symbol("FILE_SERVICE");
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

function idempotencyKey(value: string | undefined): string {
  if (!value || !keyPattern.test(value)) throw new BadRequestException();
  return value;
}

function payloadHash(value: unknown): string {
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

function file(record: FileRecord) {
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

function reference(record: FileReferenceRecord) {
  return {
    id: record.id,
    fileId: record.fileId,
    owner: record.owner,
    kind: record.kind,
    createdAt: record.createdAt.toISOString(),
  };
}

function map(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof FileNotFoundError) throw new NotFoundException();
  if (
    error instanceof FileStateConflictError ||
    error instanceof CommercialIdempotencyConflictError
  )
    throw new ConflictException();
  if (error instanceof FileValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/files")
export class FilesController {
  public constructor(@Inject(FILE_SERVICE) private readonly service: FileService) {}

  @Get()
  @RequireCrmPermission("crm:files:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0], @Query() query: unknown) {
    try {
      const parsed = FileListQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const filters: FileListFilters = {
        limit: parsed.data.limit,
        ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.fileClass === undefined ? {} : { fileClass: parsed.data.fileClass }),
      };
      const page = await this.service.list(auth.actor, auth.permissions, filters);
      return FileListResponseSchema.parse({
        data: page.items.map(file),
        page: { nextCursor: page.nextCursor },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("upload-intents")
  @RequireCrmPermission("crm:files:upload")
  public async reserveUpload(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateFileUploadIntentSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const reserved = await this.service.reserveUpload({
        ...auth,
        ...parsed.data,
        idempotencyKey: idempotencyKey(key),
        payloadHash: payloadHash(parsed.data),
      });
      return FileUploadIntentResponseSchema.parse({
        data: {
          file: file(reserved.file),
          upload: {
            ...reserved.upload,
            expiresAt: reserved.upload.expiresAt.toISOString(),
          },
        },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get(":fileId")
  @RequireCrmPermission("crm:files:read")
  public async get(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("fileId") fileId: string,
  ) {
    if (!FileIdSchema.safeParse(fileId).success) throw new BadRequestException();
    try {
      const auth = identity(request);
      return FileResponseSchema.parse({
        data: file(await this.service.get(auth.actor, auth.permissions, fileId)),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post(":fileId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireCrmPermission("crm:files:upload")
  public async complete(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("fileId") fileId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    if (!FileIdSchema.safeParse(fileId).success) throw new BadRequestException();
    try {
      const parsed = CompleteFileUploadSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const result = await this.service.completeUpload({
        ...auth,
        fileId,
        ...parsed.data,
        idempotencyKey: idempotencyKey(key),
        payloadHash: payloadHash({ fileId, ...parsed.data }),
      });
      return FileOperationResponseSchema.parse({
        data: {
          id: result.operation.id,
          fileId: result.operation.fileId,
          status: result.operation.status,
          createdAt: result.operation.createdAt.toISOString(),
          updatedAt: result.operation.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post(":fileId/references")
  @RequireCrmPermission("crm:files:reference")
  public async attachReference(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("fileId") fileId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
  ) {
    if (!FileIdSchema.safeParse(fileId).success) throw new BadRequestException();
    try {
      const parsed = CreateFileReferenceSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const result = await this.service.attachReference({
        ...auth,
        fileId,
        ...parsed.data,
        idempotencyKey: idempotencyKey(key),
        payloadHash: payloadHash({ fileId, ...parsed.data }),
      });
      return FileReferenceResponseSchema.parse({ data: reference(result.reference) });
    } catch (error) {
      return map(error);
    }
  }

  @Post(":fileId/download-authorizations")
  @HttpCode(HttpStatus.OK)
  @RequireCrmPermission("crm:files:download")
  public async authorizeDownload(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("fileId") fileId: string,
  ) {
    if (!FileIdSchema.safeParse(fileId).success) throw new BadRequestException();
    try {
      const auth = identity(request);
      const authorized = await this.service.authorizeDownload({ ...auth, fileId });
      return FileDownloadAuthorizationResponseSchema.parse({
        data: { ...authorized, expiresAt: authorized.expiresAt.toISOString() },
      });
    } catch (error) {
      return map(error);
    }
  }
}
