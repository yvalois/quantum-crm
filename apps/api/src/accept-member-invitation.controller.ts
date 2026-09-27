import {
  BadRequestException,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Body,
} from "@nestjs/common";
import {
  AcceptInvitationCommandSchema,
  AcceptInvitationResponseSchema,
  InvitationActivationResponseSchema,
  RecordInvitationActivationSchema,
} from "@quantum-crm/contracts";
import {
  IamInvitationAcceptanceError,
  IamMemberService,
  IamMemberValidationError,
} from "@quantum-crm/domain";
import { IamMemberConflictError as DatabaseConflictError } from "@quantum-crm/database";
import type { IamInvitationActivationRepository } from "@quantum-crm/domain";

import { BootstrapServiceGuard } from "./bootstrap-service-security.js";
import { CrmPublicRoute } from "./crm-security.js";
import { IAM_MEMBER_SERVICE } from "./members.controller.js";

export const IAM_INVITATION_ACTIVATION_REPOSITORY = Symbol("IAM_INVITATION_ACTIVATION_REPOSITORY");

/**
 * Service-only completion boundary. Keycloak/deploy-executor calls this after
 * its signed one-use action is consumed; a browser and a CRM member never use
 * this route. Tenant isolation comes from the profile-local API/database.
 */
@Controller("internal/iam")
@CrmPublicRoute()
export class AcceptMemberInvitationController {
  public constructor(
    @Inject(IAM_MEMBER_SERVICE) private readonly service: IamMemberService,
    @Inject(IAM_INVITATION_ACTIVATION_REPOSITORY)
    private readonly activations: IamInvitationActivationRepository,
    private readonly guard: BootstrapServiceGuard,
  ) {}

  @Post("record-member-invitation-activation")
  @HttpCode(200)
  public async recordIssued(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    await this.guard.assertAuthorized(authorization, "iam:accept-member-invitation");
    try {
      const input = RecordInvitationActivationSchema.parse(body);
      const result = await this.activations.recordIssued({
        invitationId: input.invitationId,
        oidcSubject: input.oidcSubject,
        generation: input.generation,
        expiresAt: new Date(input.expiresAt),
        now: new Date(),
      });
      if (!result) throw new ConflictException();
      return InvitationActivationResponseSchema.parse({
        data: {
          invitationId: result.activation.invitationId,
          generation: result.activation.generation,
          issuedAt: result.activation.issuedAt.toISOString(),
          expiresAt: result.activation.expiresAt.toISOString(),
        },
        replayed: result.replayed,
      });
    } catch (error) {
      if (error instanceof ConflictException || error instanceof DatabaseConflictError) {
        throw new ConflictException();
      }
      if (error instanceof IamMemberValidationError) throw new BadRequestException();
      throw error;
    }
  }

  @Post("accept-member-invitation")
  @HttpCode(200)
  public async accept(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    await this.guard.assertAuthorized(authorization, "iam:accept-member-invitation");
    try {
      const input = AcceptInvitationCommandSchema.parse(body);
      const member = await this.service.acceptConfirmedInvitation(input);
      return AcceptInvitationResponseSchema.parse({
        data: {
          id: member.id,
          displayName: member.displayName,
          email: member.email,
          status: member.status,
          authorizationRevision: member.authorizationRevision.toString(),
          createdAt: member.createdAt.toISOString(),
          updatedAt: member.updatedAt.toISOString(),
          deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      if (error instanceof IamMemberValidationError) throw new BadRequestException();
      if (error instanceof IamInvitationAcceptanceError || error instanceof DatabaseConflictError) {
        throw new ConflictException();
      }
      throw error;
    }
  }
}
