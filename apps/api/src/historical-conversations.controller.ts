import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  ConflictException,
  Patch,
  Body,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import {
  HistoricalConversationListQuerySchema,
  HistoricalConversationListResponseSchema,
  HistoricalConversationMessageListResponseSchema,
  HistoricalConversationPageQuerySchema,
  HistoricalConversationResponseSchema,
  AssignHistoricalConversationSchema,
} from "@quantum-crm/contracts";
import {
  HistoricalConversationNotFoundError,
  HistoricalAssignmentConflictError,
  HistoricalConversationService,
  HistoricalImportValidationError,
  IamAuthorizationError,
  type HistoricalMessageRecord,
  type HistoricalThreadRecord,
  type IamPermission,
} from "@quantum-crm/domain";
import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const HISTORICAL_CONVERSATION_SERVICE = Symbol("HISTORICAL_CONVERSATION_SERVICE");
function identity(request: Parameters<typeof crmAuthContext>[0]) {
  const context = crmAuthContext(request);
  return {
    actor: { memberId: context.principal.id, scope: context.commercialScope },
    permissions: context.permissions as readonly IamPermission[],
  };
}
function serialize(record: HistoricalThreadRecord | HistoricalMessageRecord) {
  return {
    ...record,
    sourceCreatedAt: record.sourceCreatedAt?.toISOString() ?? null,
    sourceUpdatedAt: record.sourceUpdatedAt?.toISOString() ?? null,
    importedAt: record.importedAt.toISOString(),
    ...("lastMessageAt" in record
      ? { lastMessageAt: record.lastMessageAt?.toISOString() ?? null }
      : {}),
    ...("attachments" in record
      ? {
          attachments: record.attachments.map((attachment) => ({
            id: attachment.id,
            attachmentIndex: attachment.attachmentIndex,
            fileId: attachment.fileId,
            status: attachment.status,
            errorCode: attachment.errorCode,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
          })),
        }
      : {}),
  };
}
function map(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof HistoricalConversationNotFoundError) throw new NotFoundException();
  if (error instanceof HistoricalAssignmentConflictError) throw new ConflictException();
  if (error instanceof HistoricalImportValidationError) throw new BadRequestException();
  throw error;
}

/** Authenticated read-only history. Import is a separately authorized host operation. */
@Controller("api/v1/historical-conversations")
export class HistoricalConversationsController {
  public constructor(
    @Inject(HISTORICAL_CONVERSATION_SERVICE)
    private readonly service: HistoricalConversationService,
  ) {}

  @Get()
  @RequireCrmPermission("crm:conversations:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0], @Query() query: unknown) {
    try {
      const parsed = HistoricalConversationListQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const { limit, cursor, contactId, contactState, query: search } = parsed.data;
      const result = await this.service.list(auth.actor, auth.permissions, {
        limit,
        ...(contactState === undefined ? {} : { contactState }),
        ...(cursor === undefined ? {} : { cursor }),
        ...(contactId === undefined ? {} : { contactId }),
        ...(search === undefined ? {} : { query: search }),
      });
      return HistoricalConversationListResponseSchema.parse({
        data: result.items.map(serialize),
        page: { nextCursor: result.nextCursor },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get(":threadId")
  @RequireCrmPermission("crm:conversations:read")
  public async find(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("threadId") threadId: string,
  ) {
    try {
      const auth = identity(request);
      const result = await this.service.find(auth.actor, auth.permissions, threadId);
      return HistoricalConversationResponseSchema.parse({ data: serialize(result) });
    } catch (error) {
      return map(error);
    }
  }

  @Get(":threadId/messages")
  @RequireCrmPermission("crm:conversations:read")
  public async messages(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("threadId") threadId: string,
    @Query() query: unknown,
  ) {
    try {
      const parsed = HistoricalConversationPageQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const { limit, cursor } = parsed.data;
      const result = await this.service.messages(auth.actor, auth.permissions, threadId, {
        limit,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return HistoricalConversationMessageListResponseSchema.parse({
        data: result.items.map(serialize),
        page: { nextCursor: result.nextCursor },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Patch(":threadId/assignee")
  @RequireCrmPermission("crm:conversations:assign")
  public async assign(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("threadId") threadId: string,
    @Body() body: unknown,
  ) {
    try {
      const parsed = AssignHistoricalConversationSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const result = await this.service.assign({
        actor: auth.actor,
        permissions: auth.permissions,
        threadId,
        ...parsed.data,
      });
      return HistoricalConversationResponseSchema.parse({ data: serialize(result) });
    } catch (error) {
      return map(error);
    }
  }
}
