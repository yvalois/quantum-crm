import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Optional,
  Post,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  IdempotencyKeySchema,
  InternalAdministratorAccessResponseSchema,
  InternalCreateAdministratorSchema,
} from "@quantum-crm/contracts";
import { DatabaseUnavailableError, IamMemberConflictError } from "@quantum-crm/database";
import {
  IamAuthorizationError,
  IamMemberService,
  IamMemberValidationError,
} from "@quantum-crm/domain";

import { BootstrapServiceGuard } from "./bootstrap-service-security.js";
import {
  CrmPublicRoute,
  IAM_INVITATION_ACTIVATION_REPOSITORY,
  IAM_MEMBER_SERVICE,
} from "./crm-security.js";
import {
  MemberActivationIssuerError,
  type MemberActivationIssuer,
} from "./member-activation-issuer.js";
import { MEMBER_ACTIVATION_ISSUER } from "./members.controller.js";

interface HeaderResponse {
  readonly setHeader: (name: string, value: string) => void;
}

@Controller("internal/iam/administrators")
@CrmPublicRoute()
export class InternalAdministratorsController {
  public constructor(
    @Inject(IAM_MEMBER_SERVICE) private readonly service: IamMemberService,
    private readonly guard: BootstrapServiceGuard,
    @Inject(MEMBER_ACTIVATION_ISSUER)
    @Optional()
    private readonly activationIssuer?: MemberActivationIssuer,
    @Inject(IAM_INVITATION_ACTIVATION_REPOSITORY)
    @Optional()
    private readonly activations?: {
      recordIssued(input: {
        readonly invitationId: string;
        readonly oidcSubject: string;
        readonly generation: number;
        readonly expiresAt: Date;
        readonly now: Date;
      }): Promise<unknown>;
    },
  ) {}

  @Post()
  @HttpCode(200)
  public async create(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    await this.guard.assertAuthorized(authorization, "iam:create-administrator");
    if (!this.activationIssuer || !this.activations) throw new ServiceUnavailableException();
    const parsed = InternalCreateAdministratorSchema.safeParse(body);
    const parsedIdempotencyKey = IdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsed.success || !parsedIdempotencyKey.success) throw new BadRequestException();
    try {
      const result = await this.service.inviteAdministratorFromPlatform({
        ...parsed.data,
        idempotencyKey: parsedIdempotencyKey.data,
      });
      const issued = await this.activationIssuer.issue({
        invitationId: result.invitation.id,
        email: result.member.email,
        displayName: result.member.displayName,
        generation: 1,
      });
      const recorded = await this.activations.recordIssued({
        invitationId: result.invitation.id,
        oidcSubject: issued.subject,
        generation: issued.generation,
        expiresAt: new Date(issued.expiresAt),
        now: new Date(),
      });
      if (!recorded) throw new ConflictException();
      response.setHeader("Cache-Control", "no-store, max-age=0");
      response.setHeader("Pragma", "no-cache");
      response.setHeader("Referrer-Policy", "no-referrer");
      return InternalAdministratorAccessResponseSchema.parse({
        data: {
          memberId: result.member.id,
          subject: issued.subject,
          username: result.member.email,
          activationUrl: issued.url,
          temporaryPassword: issued.temporaryPassword,
          expiresAt: issued.expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof IamAuthorizationError) throw new UnauthorizedException();
      if (error instanceof IamMemberValidationError) throw new BadRequestException();
      if (error instanceof IamMemberConflictError) throw new ConflictException();
      if (error instanceof DatabaseUnavailableError) throw new ServiceUnavailableException();
      if (error instanceof MemberActivationIssuerError) {
        if (error.reason === "TARGET_CONFLICT") throw new ConflictException();
        throw new ServiceUnavailableException();
      }
      throw error;
    }
  }
}
