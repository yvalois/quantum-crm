import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Patch,
  PreconditionFailedException,
  Body,
  Req,
} from "@nestjs/common";
import { AgentControlResponseSchema, UpdateAgentControlSchema } from "@quantum-crm/contracts";
import {
  AgentControlService,
  ConversationVersionConflictError,
  IamAuthorizationError,
} from "@quantum-crm/domain";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const AGENT_CONTROL_SERVICE = Symbol("AGENT_CONTROL_SERVICE");

@Controller("api/v1/agent-control")
export class AgentControlController {
  public constructor(
    @Inject(AGENT_CONTROL_SERVICE) private readonly service: AgentControlService,
  ) {}

  @Get()
  @RequireCrmPermission("crm:conversations:read")
  public async get(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    const context = crmAuthContext(request);
    const result = await this.service.get(context.permissions);
    return AgentControlResponseSchema.parse({
      data: {
        enabled: result.enabled,
        version: result.version.toString(),
        updatedAt: result.updatedAt.toISOString(),
      },
    });
  }

  @Patch()
  @RequireCrmPermission("crm:conversations:configure")
  public async set(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const parsed = UpdateAgentControlSchema.safeParse(body);
    if (!parsed.success || !idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey))
      throw new BadRequestException();
    const match = ifMatch ? /^"([1-9][0-9]*)"$/u.exec(ifMatch) : null;
    if (!match?.[1])
      throw new HttpException("If-Match is required", HttpStatus.PRECONDITION_REQUIRED);
    const context = crmAuthContext(request);
    try {
      const result = await this.service.set({
        permissions: context.permissions,
        actorMemberId: context.principal.id,
        expectedVersion: BigInt(match[1]),
        enabled: parsed.data.enabled,
      });
      return AgentControlResponseSchema.parse({
        data: {
          enabled: result.enabled,
          version: result.version.toString(),
          updatedAt: result.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      if (error instanceof IamAuthorizationError) throw new ForbiddenException();
      if (error instanceof ConversationVersionConflictError)
        throw new PreconditionFailedException();
      throw error;
    }
  }
}
