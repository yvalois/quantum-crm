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
  ConversationListQuerySchema,
  ConversationListResponseSchema,
  ConversationMessageResponseSchema,
  ConversationResponseSchema,
  ConversationThreadResponseSchema,
  CreateConversationNoteSchema,
  CreateConversationSchema,
  CreateQuickReplySchema,
  QuickReplyListResponseSchema,
  QuickReplyResponseSchema,
  SendConversationMessageSchema,
  UpdateConversationSchema,
} from "@quantum-crm/contracts";
import { ConversationIdempotencyConflictError } from "@quantum-crm/database";
import {
  ConversationNotFoundError,
  ConversationService,
  ConversationValidationError,
  ConversationVersionConflictError,
  IamAuthorizationError,
  type CommercialActor,
  type ConversationHistoryRecord,
  type ConversationMessageRecord,
  type ConversationRecord,
  type IamPermission,
  type QuickReplyRecord,
} from "@quantum-crm/domain";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const CONVERSATION_SERVICE = Symbol("CONVERSATION_SERVICE");
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
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
function id(value: string): string {
  if (!uuidPattern.test(value)) throw new BadRequestException();
  return value;
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
function conversation(value: ConversationRecord) {
  return {
    ...value,
    version: value.version.toString(),
    lastMessageAt: value.lastMessageAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}
function message(value: ConversationMessageRecord) {
  return {
    ...value,
    sequence: value.sequence.toString(),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}
function history(value: ConversationHistoryRecord) {
  return { ...value, createdAt: value.createdAt.toISOString() };
}
function reply(value: QuickReplyRecord) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}
function map(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof ConversationIdempotencyConflictError) throw new ConflictException();
  if (error instanceof ConversationNotFoundError) throw new NotFoundException();
  if (error instanceof ConversationVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof ConversationValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/conversations")
export class ConversationsController {
  public constructor(@Inject(CONVERSATION_SERVICE) private readonly service: ConversationService) {}

  @Get()
  @RequireCrmPermission("crm:conversations:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0], @Query() query: unknown) {
    try {
      const parsed = ConversationListQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const actor = identity(request);
      const {
        cursor,
        query: search,
        channel,
        status,
        attentionMode,
        assigneeMemberId,
        unassigned,
      } = parsed.data;
      const result = await this.service.list(actor.actor, actor.permissions, {
        limit: parsed.data.limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { query: search }),
        ...(channel === undefined ? {} : { channel }),
        ...(status === undefined ? {} : { status }),
        ...(attentionMode === undefined ? {} : { attentionMode }),
        ...(assigneeMemberId === undefined ? {} : { assigneeMemberId }),
        ...(unassigned === undefined ? {} : { unassigned }),
      });
      return ConversationListResponseSchema.parse({
        data: result.items.map(conversation),
        page: { nextCursor: result.nextCursor },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post()
  @RequireCrmPermission("crm:conversations:reply")
  public async create(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateConversationSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const actor = identity(request);
      return ConversationResponseSchema.parse({
        data: conversation(
          await this.service.create({
            ...actor,
            contactId: parsed.data.contactId,
            channel: parsed.data.channel,
            initialMessage: parsed.data.initialMessage,
            ...(parsed.data.subject === undefined ? {} : { subject: parsed.data.subject }),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(parsed.data),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("quick-replies")
  @RequireCrmPermission("crm:conversations:read")
  public async quickReplies(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      const actor = identity(request);
      return QuickReplyListResponseSchema.parse({
        data: (await this.service.listQuickReplies(actor.permissions)).map(reply),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("quick-replies")
  @RequireCrmPermission("crm:conversations:configure")
  public async createQuickReply(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateQuickReplySchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const actor = identity(request);
      return QuickReplyResponseSchema.parse({
        data: reply(
          await this.service.createQuickReply({
            ...actor,
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

  @Get(":conversationId")
  @RequireCrmPermission("crm:conversations:read")
  public async thread(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("conversationId") conversationId: string,
  ) {
    try {
      const actor = identity(request);
      const result = await this.service.thread(actor.actor, actor.permissions, id(conversationId));
      return ConversationThreadResponseSchema.parse({
        data: {
          conversation: conversation(result.conversation),
          messages: result.messages.map(message),
          history: result.history.map(history),
        },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Patch(":conversationId")
  @RequireCrmPermission("crm:conversations:reply")
  public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("conversationId") conversationId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = UpdateConversationSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const actor = identity(request);
      const expectedVersion = version(ifMatch);
      return ConversationResponseSchema.parse({
        data: conversation(
          await this.service.update({
            ...actor,
            id: id(conversationId),
            expectedVersion,
            ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
            ...(parsed.data.attentionMode === undefined
              ? {}
              : { attentionMode: parsed.data.attentionMode }),
            ...(parsed.data.assigneeMemberId === undefined
              ? {}
              : { assigneeMemberId: parsed.data.assigneeMemberId }),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              id: conversationId,
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

  @Post(":conversationId/messages")
  @RequireCrmPermission("crm:conversations:reply")
  public async send(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("conversationId") conversationId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = SendConversationMessageSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const actor = identity(request);
      const expectedVersion = version(ifMatch);
      return ConversationMessageResponseSchema.parse({
        data: message(
          await this.service.send({
            ...actor,
            conversationId: id(conversationId),
            expectedVersion,
            ...parsed.data,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              conversationId,
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

  @Post(":conversationId/notes")
  @RequireCrmPermission("crm:conversations:reply")
  public async addNote(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("conversationId") conversationId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateConversationNoteSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const actor = identity(request);
      const expectedVersion = version(ifMatch);
      return ConversationMessageResponseSchema.parse({
        data: message(
          await this.service.addNote({
            ...actor,
            conversationId: id(conversationId),
            expectedVersion,
            body: parsed.data.body,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              conversationId,
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
}
