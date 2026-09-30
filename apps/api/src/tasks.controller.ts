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
  CreateTaskCommentSchema,
  CreateTaskSchema,
  TaskAssigneeListResponseSchema,
  TaskCommentListResponseSchema,
  TaskCommentResponseSchema,
  TaskHistoryListResponseSchema,
  TaskListQuerySchema,
  TaskListResponseSchema,
  TaskResponseSchema,
  UpdateTaskSchema,
  UpdateTaskStatusSchema,
} from "@quantum-crm/contracts";
import {
  IamAuthorizationError,
  TaskNotFoundError,
  TaskService,
  TaskValidationError,
  TaskVersionConflictError,
  type CommercialActor,
  type IamPermission,
} from "@quantum-crm/domain";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";
import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const TASK_SERVICE = Symbol("TASK_SERVICE");
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
function identity(request: Parameters<typeof crmAuthContext>[0]): {
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
function response(task: {
  readonly id: string;
  readonly contactId: string | null;
  readonly opportunityId: string | null;
  readonly assigneeMemberId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: string;
  readonly type: string;
  readonly origin: string;
  readonly dueAt: Date | null;
  readonly status: string;
  readonly completedAt: Date | null;
  readonly completedByMemberId: string | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return {
    id: task.id,
    contactId: task.contactId,
    opportunityId: task.opportunityId,
    assigneeMemberId: task.assigneeMemberId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    type: task.type,
    origin: task.origin,
    dueAt: task.dueAt?.toISOString() ?? null,
    status: task.status,
    completedAt: task.completedAt?.toISOString() ?? null,
    completedByMemberId: task.completedByMemberId,
    version: task.version.toString(),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
function map(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof CommercialIdempotencyConflictError) throw new ConflictException();
  if (error instanceof TaskNotFoundError) throw new NotFoundException();
  if (error instanceof TaskVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof TaskValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/tasks")
export class TasksController {
  public constructor(@Inject(TASK_SERVICE) private readonly service: TaskService) {}
  @Get() @RequireCrmPermission("crm:tasks:read") public async list(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query() query: unknown,
  ) {
    try {
      const parsed = TaskListQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const { contactId, opportunityId, assigneeMemberId, status, priority, type, dueFrom, dueTo } =
        parsed.data;
      const actor = identity(request);
      return TaskListResponseSchema.parse({
        data: (
          await this.service.list(actor.actor, actor.permissions, {
            ...(contactId === undefined ? {} : { contactId }),
            ...(opportunityId === undefined ? {} : { opportunityId }),
            ...(assigneeMemberId === undefined ? {} : { assigneeMemberId }),
            ...(status === undefined ? {} : { status }),
            ...(priority === undefined ? {} : { priority }),
            ...(type === undefined ? {} : { type }),
            ...(dueFrom === undefined ? {} : { dueFrom: new Date(dueFrom) }),
            ...(dueTo === undefined ? {} : { dueTo: new Date(dueTo) }),
          })
        ).map(response),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Get("assignees") @RequireCrmPermission("crm:tasks:read") public async assignees(
    @Req() request: Parameters<typeof crmAuthContext>[0],
  ) {
    try {
      const actor = identity(request);
      return TaskAssigneeListResponseSchema.parse({
        data: await this.service.listActiveAssignees(actor.permissions),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Post() @RequireCrmPermission("crm:tasks:create") public async create(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateTaskSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const payload = parsed.data;
      const actor = identity(request);
      return TaskResponseSchema.parse({
        data: response(
          await this.service.create({
            ...actor,
            ...(payload.contactId === undefined ? {} : { contactId: payload.contactId }),
            ...(payload.opportunityId === undefined
              ? {}
              : { opportunityId: payload.opportunityId }),
            assigneeMemberId: payload.assigneeMemberId,
            title: payload.title,
            description: payload.description,
            priority: payload.priority,
            type: payload.type,
            dueAt: new Date(payload.dueAt),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(payload),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Patch(":taskId") @RequireCrmPermission("crm:tasks:update") public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("taskId") taskId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(taskId)) throw new BadRequestException();
    try {
      const parsed = UpdateTaskSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const { assigneeMemberId, title, description, priority, type, dueAt } = parsed.data;
      const actor = identity(request);
      const expectedVersion = version(ifMatch);
      return TaskResponseSchema.parse({
        data: response(
          await this.service.update({
            ...actor,
            id: taskId,
            patch: {
              ...(assigneeMemberId === undefined ? {} : { assigneeMemberId }),
              ...(title === undefined ? {} : { title }),
              ...(description === undefined ? {} : { description }),
              ...(priority === undefined ? {} : { priority }),
              ...(type === undefined ? {} : { type }),
              ...(dueAt === undefined ? {} : { dueAt: new Date(dueAt) }),
            },
            expectedVersion,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              taskId,
              ...parsed.data,
              expectedVersion: expectedVersion.toString(),
            }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Patch(":taskId/status") @RequireCrmPermission("crm:tasks:update") public async updateStatus(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("taskId") taskId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(taskId)) throw new BadRequestException();
    try {
      const parsed = UpdateTaskStatusSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const actor = identity(request);
      const expectedVersion = version(ifMatch);
      return TaskResponseSchema.parse({
        data: response(
          await this.service.updateStatus({
            ...actor,
            id: taskId,
            ...parsed.data,
            expectedVersion,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              taskId,
              ...parsed.data,
              expectedVersion: expectedVersion.toString(),
            }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Get(":taskId/comments")
  @RequireCrmPermission("crm:tasks:read")
  public async comments(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("taskId") taskId: string,
  ) {
    if (!uuidPattern.test(taskId)) throw new BadRequestException();
    try {
      const actor = identity(request);
      return TaskCommentListResponseSchema.parse({
        data: (await this.service.listComments(actor.actor, actor.permissions, taskId)).map(
          (comment) => ({ ...comment, createdAt: comment.createdAt.toISOString() }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Post(":taskId/comments")
  @RequireCrmPermission("crm:tasks:update")
  public async addComment(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("taskId") taskId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(taskId)) throw new BadRequestException();
    try {
      const parsed = CreateTaskCommentSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const actor = identity(request);
      const comment = await this.service.addComment({
        ...actor,
        taskId,
        body: parsed.data.body,
        idempotencyKey: key(idempotencyKey),
        payloadHash: hash({ taskId, ...parsed.data }),
      });
      return TaskCommentResponseSchema.parse({
        data: { ...comment, createdAt: comment.createdAt.toISOString() },
      });
    } catch (error) {
      return map(error);
    }
  }
  @Get(":taskId/history")
  @RequireCrmPermission("crm:tasks:read")
  public async history(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("taskId") taskId: string,
  ) {
    if (!uuidPattern.test(taskId)) throw new BadRequestException();
    try {
      const actor = identity(request);
      return TaskHistoryListResponseSchema.parse({
        data: (await this.service.listHistory(actor.actor, actor.permissions, taskId)).map(
          (entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
}
