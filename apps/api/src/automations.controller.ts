import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  ActivateAutomationSchema,
  AutomationActivationResponseSchema,
  AutomationListResponseSchema,
  AutomationResponseSchema,
  CreateAutomationSchema,
} from "@quantum-crm/contracts";
import {
  AutomationNotFoundError,
  AutomationService,
  AutomationValidationError,
  IamAuthorizationError,
  type CommercialActor,
  type IamPermission,
} from "@quantum-crm/domain";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const AUTOMATION_SERVICE = Symbol("AUTOMATION_SERVICE");
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function payloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function actor(request: Parameters<typeof crmAuthContext>[0]): {
  readonly actor: CommercialActor;
  readonly permissions: readonly IamPermission[];
} {
  const context = crmAuthContext(request);
  return Object.freeze({
    actor: Object.freeze({ memberId: context.principal.id, scope: context.commercialScope }),
    permissions: context.permissions as readonly IamPermission[],
  });
}

function automationResponse(value: {
  readonly id: string;
  readonly name: string;
  readonly status: "DRAFT" | "ACTIVE" | "PAUSED";
  readonly triggerEvent: "CONTACT_MANUAL";
  readonly action: {
    readonly type: "CREATE_TASK";
    readonly title: string;
    readonly description: string;
    readonly priority: "LOW" | "MEDIUM" | "HIGH";
    readonly dueHours: number;
  };
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return AutomationResponseSchema.parse({
    data: {
      id: value.id,
      name: value.name,
      status: value.status,
      triggerEvent: value.triggerEvent,
      action: value.action,
      version: value.version.toString(),
      createdAt: value.createdAt.toISOString(),
      updatedAt: value.updatedAt.toISOString(),
    },
  });
}

function key(value: string | undefined): string {
  if (!value || !keyPattern.test(value)) throw new BadRequestException();
  return value;
}

function mapError(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof AutomationNotFoundError) throw new NotFoundException();
  if (error instanceof AutomationValidationError) throw new BadRequestException();
  if (error instanceof CommercialIdempotencyConflictError) throw new ConflictException();
  throw error;
}

@Controller("api/v1/automations")
export class AutomationsController {
  public constructor(@Inject(AUTOMATION_SERVICE) private readonly service: AutomationService) {}

  @Get()
  @RequireCrmPermission("crm:automations:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      const result = await this.service.list(actor(request).permissions);
      return AutomationListResponseSchema.parse({
        data: result.map((automation) => automationResponse(automation).data),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Post()
  @RequireCrmPermission("crm:automations:configure")
  public async create(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const payload = CreateAutomationSchema.parse(body);
      const identity = actor(request);
      const created = await this.service.create({
        ...identity,
        ...payload,
        idempotencyKey: key(idempotencyKey),
        payloadHash: payloadHash(payload),
      });
      return automationResponse(created);
    } catch (error) {
      return mapError(error);
    }
  }

  @Post(":automationId/activate")
  @RequireCrmPermission("crm:automations:execute")
  public async activate(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("automationId") automationId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      if (!uuidPattern.test(automationId)) throw new BadRequestException();
      const payload = ActivateAutomationSchema.parse(body);
      const identity = actor(request);
      const operationKey = key(idempotencyKey);
      const result = await this.service.activate({
        ...identity,
        automationId,
        ...payload,
        operationKey,
        payloadHash: payloadHash({ automationId, ...payload }),
      });
      return AutomationActivationResponseSchema.parse({ data: result });
    } catch (error) {
      return mapError(error);
    }
  }
}
