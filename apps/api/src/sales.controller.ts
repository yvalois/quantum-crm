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
  CreateOpportunitySchema,
  CreatePipelineSchema,
  CreatePipelineStageSchema,
  MoveOpportunitySchema,
  OpportunityHistoryListResponseSchema,
  OpportunityListQuerySchema,
  OpportunityListResponseSchema,
  OpportunityResponseSchema,
  PipelineListResponseSchema,
  PipelineResponseSchema,
  UpdateOpportunitySchema,
} from "@quantum-crm/contracts";
import {
  IamAuthorizationError,
  SalesNotFoundError,
  SalesService,
  SalesValidationError,
  SalesVersionConflictError,
  type CommercialActor,
  type IamPermission,
} from "@quantum-crm/domain";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const SALES_SERVICE = Symbol("SALES_SERVICE");
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
function pipelineResponse(value: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly stages: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly position: number;
  }[];
  readonly createdAt: Date;
}) {
  return {
    id: value.id,
    name: value.name,
    description: value.description,
    stages: value.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      description: stage.description,
      position: stage.position,
    })),
    createdAt: value.createdAt.toISOString(),
  };
}
function opportunityResponse(value: {
  readonly id: string;
  readonly ownerMemberId: string;
  readonly contactId: string;
  readonly pipelineId: string;
  readonly stageId: string;
  readonly title: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: "OPEN" | "WON" | "LOST" | "ABANDONED";
  readonly closeReason: string | null;
  readonly closedAt: Date | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return {
    id: value.id,
    ownerMemberId: value.ownerMemberId,
    contactId: value.contactId,
    pipelineId: value.pipelineId,
    stageId: value.stageId,
    title: value.title,
    amountMinor: value.amountMinor.toString(),
    currency: value.currency,
    status: value.status,
    closeReason: value.closeReason,
    closedAt: value.closedAt?.toISOString() ?? null,
    version: value.version.toString(),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}
function map(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof CommercialIdempotencyConflictError) throw new ConflictException();
  if (error instanceof SalesNotFoundError) throw new NotFoundException();
  if (error instanceof SalesVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof SalesValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/sales")
export class SalesController {
  public constructor(@Inject(SALES_SERVICE) private readonly service: SalesService) {}
  @Get("pipelines") @RequireCrmPermission("crm:sales:read") public async listPipelines(
    @Req() request: Parameters<typeof crmAuthContext>[0],
  ) {
    try {
      const actor = identity(request);
      return PipelineListResponseSchema.parse({
        data: (await this.service.listPipelines(actor.permissions)).map(pipelineResponse),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Post("pipelines") @RequireCrmPermission("crm:sales:configure") public async createPipeline(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsedPayload = CreatePipelineSchema.safeParse(body);
      if (!parsedPayload.success) throw new BadRequestException();
      const payload = parsedPayload.data;
      const actor = identity(request);
      return PipelineResponseSchema.parse({
        data: pipelineResponse(
          await this.service.createPipeline({
            ...actor,
            ...payload,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(payload),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Post("pipelines/:pipelineId/stages")
  @RequireCrmPermission("crm:sales:configure")
  public async addStage(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("pipelineId") pipelineId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(pipelineId)) throw new BadRequestException();
    try {
      const payload = CreatePipelineStageSchema.parse(body);
      const actor = identity(request);
      const stage = await this.service.addStage({
        ...actor,
        pipelineId,
        ...payload,
        idempotencyKey: key(idempotencyKey),
        payloadHash: hash(payload),
      });
      return { data: stage };
    } catch (error) {
      return map(error);
    }
  }
  @Get("opportunities") @RequireCrmPermission("crm:sales:read") public async listOpportunities(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query() query: unknown,
  ) {
    try {
      const actor = identity(request);
      const filters = OpportunityListQuerySchema.parse(query);
      return OpportunityListResponseSchema.parse({
        data: (await this.service.listOpportunities(actor.actor, actor.permissions, filters)).map(
          opportunityResponse,
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Get("opportunities/:opportunityId/history")
  @RequireCrmPermission("crm:sales:read")
  public async history(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("opportunityId") opportunityId: string,
  ) {
    if (!uuidPattern.test(opportunityId)) throw new BadRequestException();
    try {
      const actor = identity(request);
      const history = await this.service.listOpportunityHistory({
        ...actor,
        opportunityId,
      });
      return OpportunityHistoryListResponseSchema.parse({
        data: history.map((entry) => ({
          ...entry,
          previousAmountMinor: entry.previousAmountMinor?.toString() ?? null,
          nextAmountMinor: entry.nextAmountMinor?.toString() ?? null,
          createdAt: entry.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Patch("opportunities/:opportunityId")
  @RequireCrmPermission("crm:sales:update")
  public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("opportunityId") opportunityId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(opportunityId)) throw new BadRequestException();
    try {
      const payload = UpdateOpportunitySchema.parse(body);
      const { amountMinor, ...changes } = payload;
      const actor = identity(request);
      const expectedVersion = version(ifMatch);
      return OpportunityResponseSchema.parse({
        data: opportunityResponse(
          await this.service.updateOpportunity({
            ...actor,
            ...changes,
            opportunityId,
            ...(amountMinor === undefined ? {} : { amountMinor: BigInt(amountMinor) }),
            expectedVersion,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({ ...payload, expectedVersion: expectedVersion.toString() }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Post("opportunities") @RequireCrmPermission("crm:sales:create") public async createOpportunity(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const payload = CreateOpportunitySchema.parse(body);
      const actor = identity(request);
      return OpportunityResponseSchema.parse({
        data: opportunityResponse(
          await this.service.createOpportunity({
            ...actor,
            ...payload,
            amountMinor: BigInt(payload.amountMinor),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(payload),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
  @Patch("opportunities/:opportunityId/move")
  @RequireCrmPermission("crm:sales:move")
  public async move(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("opportunityId") opportunityId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(opportunityId)) throw new BadRequestException();
    try {
      const payload = MoveOpportunitySchema.parse(body);
      const actor = identity(request);
      const expectedVersion = version(ifMatch);
      return OpportunityResponseSchema.parse({
        data: opportunityResponse(
          await this.service.moveOpportunity({
            ...actor,
            opportunityId,
            ...payload,
            expectedVersion,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({ ...payload, expectedVersion: expectedVersion.toString() }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
}
