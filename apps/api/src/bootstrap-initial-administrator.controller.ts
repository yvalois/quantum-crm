import { Body, ConflictException, Controller, Headers, HttpCode, Inject, Post, UnauthorizedException } from "@nestjs/common";
import {
  BootstrapInitialAdministratorResponseSchema,
  BootstrapInitialAdministratorSchema,
  IdempotencyKeySchema,
} from "@quantum-crm/contracts";
import { IamMemberConflictError } from "@quantum-crm/database";
import { IamMemberService, IamMemberValidationError } from "@quantum-crm/domain";

import { BootstrapServiceGuard } from "./bootstrap-service-security.js";
import { CrmPublicRoute } from "./crm-security.js";
import { IAM_MEMBER_SERVICE } from "./members.controller.js";

@Controller("internal/iam")
@CrmPublicRoute()
export class BootstrapInitialAdministratorController {
  public constructor(
    @Inject(IAM_MEMBER_SERVICE) private readonly service: IamMemberService,
    private readonly guard: BootstrapServiceGuard,
  ) {}

  @Post("bootstrap-initial-administrator")
  @HttpCode(200)
  public async bootstrap(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    await this.guard.assertAuthorized(authorization);
    try {
      const input = BootstrapInitialAdministratorSchema.parse(body);
      const result = await this.service.bootstrapInitialAdministrator({
        oidcSubject: input.subject,
        idempotencyKey: IdempotencyKeySchema.parse(idempotencyKey),
      });
      return BootstrapInitialAdministratorResponseSchema.parse({
        data: {
          id: result.member.id,
          status: result.member.status,
          authorizationRevision: result.member.authorizationRevision.toString(),
        },
        replayed: result.replayed,
      });
    } catch (error) {
      if (error instanceof IamMemberValidationError) throw new UnauthorizedException();
      if (error instanceof IamMemberConflictError) throw new ConflictException();
      throw error;
    }
  }
}
