import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
} from "@nestjs/common";
import {
  UnifiedInboxListQuerySchema,
  UnifiedInboxListResponseSchema,
} from "@quantum-crm/contracts";
import {
  ConversationValidationError,
  IamAuthorizationError,
  UnifiedInboxService,
  type IamPermission,
  type UnifiedInboxRecord,
} from "@quantum-crm/domain";
import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const UNIFIED_INBOX_SERVICE = Symbol("UNIFIED_INBOX_SERVICE");
function serialize(item: UnifiedInboxRecord) {
  if (item.source === "QUANTUM") {
    const record = item.conversation;
    return {
      source: item.source,
      conversation: {
        ...record,
        version: record.version.toString(),
        lastMessageAt: record.lastMessageAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      },
    };
  }
  const record = item.conversation;
  return {
    source: item.source,
    conversation: {
      ...record,
      sourceCreatedAt: record.sourceCreatedAt?.toISOString() ?? null,
      sourceUpdatedAt: record.sourceUpdatedAt?.toISOString() ?? null,
      lastMessageAt: record.lastMessageAt?.toISOString() ?? null,
      importedAt: record.importedAt.toISOString(),
    },
  };
}

@Controller("api/v1/conversations/inbox")
export class UnifiedInboxController {
  public constructor(
    @Inject(UNIFIED_INBOX_SERVICE) private readonly service: UnifiedInboxService,
  ) {}

  @Get()
  @RequireCrmPermission("crm:conversations:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0], @Query() query: unknown) {
    try {
      const parsed = UnifiedInboxListQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const context = crmAuthContext(request);
      const result = await this.service.list(
        { memberId: context.principal.id, scope: context.commercialScope },
        context.permissions as readonly IamPermission[],
        parsed.data,
      );
      return UnifiedInboxListResponseSchema.parse({
        data: result.items.map(serialize),
        page: { nextCursor: result.nextCursor },
      });
    } catch (error) {
      if (error instanceof IamAuthorizationError) throw new ForbiddenException();
      if (error instanceof ConversationValidationError) throw new BadRequestException();
      throw error;
    }
  }
}
