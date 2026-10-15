import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  PreconditionFailedException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  Query,
  Req,
} from "@nestjs/common";
import {
  CreateMemberInvitationSchema,
  InvitationActivationDeliverySchema,
  InvitationResponseSchema,
  MemberIdSchema,
  MemberListQuerySchema,
  MemberListResponseSchema,
  CommercialAdvisorListResponseSchema,
  MemberResponseSchema,
  MemberCapabilitiesResponseSchema,
  UpdateMemberSchema,
  type MemberListResponse,
} from "@quantum-crm/contracts";
import {
  IamAuthorizationError,
  IamMemberNotFoundError,
  IamMemberRevisionConflictError,
  IamMemberService,
  IamMemberValidationError,
  IamInvitationRevocationError,
  type IamMember,
  type IamPermission,
} from "@quantum-crm/domain";
import { IamMemberConflictError } from "@quantum-crm/database";

import {
  crmAuthContext,
  IAM_INVITATION_ACTIVATION_REPOSITORY,
  IAM_MEMBER_SERVICE,
  RequireCrmPermission,
} from "./crm-security.js";
import {
  MemberActivationIssuerError,
  type MemberActivationIssuer,
} from "./member-activation-issuer.js";

export const MEMBER_ACTIVATION_ISSUER = Symbol("MEMBER_ACTIVATION_ISSUER");
function actor(request: Parameters<typeof crmAuthContext>[0]): {
  readonly memberId: string;
  readonly permissions: readonly IamPermission[];
} {
  const context = crmAuthContext(request);
  return Object.freeze({
    memberId: context.principal.id,
    permissions: context.permissions as readonly IamPermission[],
  });
}

function memberResponse(member: IamMember) {
  return MemberResponseSchema.parse({
    data: {
      id: member.id,
      displayName: member.displayName,
      email: member.email,
      status: member.status,
      authorizationRevision: member.authorizationRevision.toString(),
      createdAt: member.createdAt.toISOString(),
      updatedAt: member.updatedAt.toISOString(),
      deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
      commercialScope:
        member.commercialScope === "PROFILE"
          ? "PROFILE"
          : member.commercialScope === "TEAM"
            ? "TEAM"
            : "ASSIGNED",
      ...(member.roleCode ? { roleCode: member.roleCode } : {}),
    },
  });
}

function mapMemberError(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof IamMemberNotFoundError) throw new NotFoundException();
  if (
    error instanceof IamMemberRevisionConflictError ||
    (error instanceof Error && error.name === "IamMemberRevisionConflictError")
  ) {
    throw new PreconditionFailedException();
  }
  if (error instanceof IamMemberValidationError) throw new BadRequestException();
  if (error instanceof IamInvitationRevocationError) throw new ConflictException();
  throw error;
}

function expectedAuthorizationRevision(value: string | undefined): bigint {
  const match = typeof value === "string" ? /^"([1-9][0-9]*)"$/u.exec(value) : null;
  if (!match?.[1]) {
    throw new HttpException(
      "If-Match is required for scope changes",
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  return BigInt(match[1]);
}

@Controller("api/v1/members")
export class MembersController {
  public constructor(
    @Inject(IAM_MEMBER_SERVICE) private readonly service: IamMemberService,
    @Inject(MEMBER_ACTIVATION_ISSUER)
    @Optional()
    private readonly activationIssuer?: MemberActivationIssuer,
    @Inject(IAM_INVITATION_ACTIVATION_REPOSITORY)
    @Optional()
    private readonly activations?: {
      reserveReissue(input: {
        readonly memberId: string;
        readonly actorMemberId: string;
        readonly requestKey: string;
        readonly now: Date;
      }): Promise<{
        readonly invitationId: string;
        readonly email: string;
        readonly displayName: string;
        readonly generation: number;
      } | null>;
      recordIssued(input: {
        readonly invitationId: string;
        readonly oidcSubject: string;
        readonly generation: number;
        readonly expiresAt: Date;
        readonly now: Date;
      }): Promise<{
        readonly activation: {
          readonly invitationId: string;
          readonly generation: number;
          readonly issuedAt: Date;
          readonly expiresAt: Date;
        };
        readonly replayed: boolean;
      } | null>;
    },
  ) {}

  @Get("self/capabilities")
  public capabilities(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    const context = crmAuthContext(request);
    return MemberCapabilitiesResponseSchema.parse({
      data: {
        memberId: context.principal.id,
        canAssignSales: context.permissions.includes("crm:sales:assign"),
        canAssignContacts: context.permissions.includes("crm:contacts:assign"),
        canAssignConversations: context.permissions.includes("crm:conversations:assign"),
        canConfigureAgent: context.permissions.includes("crm:conversations:configure"),
        canManageMembers: context.permissions.includes("iam:members:roles"),
        canViewAllCalendarEvents: context.permissions.includes("crm:calendar:read-all"),
        canConfigureCalendar: context.permissions.includes("crm:calendar:configure"),
        canManageCatalog: context.permissions.includes("crm:catalog:write"),
        canManageCatalogStock: context.permissions.includes("crm:catalog:stock"),
      },
    });
  }

  @Get()
  @RequireCrmPermission("iam:members:read")
  public async list(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query() query: unknown,
  ): Promise<MemberListResponse> {
    const criteria = MemberListQuerySchema.parse(query);
    const result = await this.service.list(actor(request), {
      limit: criteria.limit,
      ...(criteria.cursor === undefined ? {} : { cursor: criteria.cursor }),
      ...(criteria.status === undefined ? {} : { status: criteria.status }),
    });
    return MemberListResponseSchema.parse({
      data: result.members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        email: member.email,
        status: member.status,
        authorizationRevision: member.authorizationRevision.toString(),
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
        deactivatedAt: member.deactivatedAt?.toISOString() ?? null,
        commercialScope:
          member.commercialScope === "PROFILE"
            ? "PROFILE"
            : member.commercialScope === "TEAM"
              ? "TEAM"
              : "ASSIGNED",
        ...(member.roleCode ? { roleCode: member.roleCode } : {}),
      })),
      page: { nextCursor: result.nextCursor },
    });
  }

  @Get("advisors")
  public async advisors(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      return CommercialAdvisorListResponseSchema.parse({
        data: await this.service.listCommercialAdvisors(actor(request)),
      });
    } catch (error) {
      return mapMemberError(error);
    }
  }

  @Post("invitations")
  @RequireCrmPermission("iam:members:create")
  public async invite(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (typeof idempotencyKey !== "string") throw new BadRequestException();
    try {
      const input = CreateMemberInvitationSchema.parse(body);
      const result = await this.service.invite({ ...input, actor: actor(request), idempotencyKey });
      let activation:
        | {
            readonly url: string;
            readonly temporaryPassword: string;
            readonly expiresAt: string;
          }
        | undefined;
      if (result.invitationToken !== null) {
        if (!this.activationIssuer || !this.activations) throw new ServiceUnavailableException();
        try {
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
          activation = {
            url: issued.url,
            temporaryPassword: issued.temporaryPassword,
            expiresAt: issued.expiresAt,
          };
        } catch (error) {
          if (error instanceof ConflictException) throw error;
          if (error instanceof MemberActivationIssuerError) {
            if (error.reason === "TARGET_CONFLICT") throw new ConflictException();
            throw new ServiceUnavailableException();
          }
          throw error;
        }
      }
      return InvitationResponseSchema.parse({
        data: {
          id: result.invitation.id,
          memberId: result.invitation.memberId,
          status: result.invitation.status,
          expiresAt: result.invitation.expiresAt.toISOString(),
          acceptedAt: result.invitation.acceptedAt?.toISOString() ?? null,
          createdAt: result.invitation.createdAt.toISOString(),
        },
        ...(activation ? { activation } : {}),
      });
    } catch (error) {
      return mapMemberError(error);
    }
  }

  @Patch(":memberId")
  @RequireCrmPermission("iam:members:update")
  public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("memberId") memberId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const input = UpdateMemberSchema.parse(body);
      return memberResponse(
        await this.service.updateProfile({
          actor: actor(request),
          memberId: MemberIdSchema.parse(memberId),
          ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
          ...(input.email === undefined ? {} : { email: input.email }),
          ...(input.roleCode === undefined ? {} : { roleCode: input.roleCode }),
          ...(input.commercialScope === undefined
            ? {}
            : { commercialScope: input.commercialScope }),
          ...(input.commercialScope === undefined
            ? {}
            : { expectedAuthorizationRevision: expectedAuthorizationRevision(ifMatch) }),
        }),
      );
    } catch (error) {
      return mapMemberError(error);
    }
  }

  @Delete(":memberId")
  @RequireCrmPermission("iam:members:deactivate")
  public async deactivate(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("memberId") memberId: string,
  ) {
    try {
      return memberResponse(
        await this.service.deactivate({
          actor: actor(request),
          memberId: MemberIdSchema.parse(memberId),
        }),
      );
    } catch (error) {
      return mapMemberError(error);
    }
  }

  @Post(":memberId/invitation/revoke")
  @RequireCrmPermission("iam:members:update")
  public async revokeInvitation(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("memberId") memberId: string,
  ) {
    try {
      const invitation = await this.service.revokeInvitation({
        actor: actor(request),
        memberId: MemberIdSchema.parse(memberId),
      });
      return InvitationResponseSchema.parse({
        data: {
          id: invitation.id,
          memberId: invitation.memberId,
          status: invitation.status,
          expiresAt: invitation.expiresAt.toISOString(),
          acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
          createdAt: invitation.createdAt.toISOString(),
        },
      });
    } catch (error) {
      return mapMemberError(error);
    }
  }

  @Post(":memberId/invitation/reissue")
  @RequireCrmPermission("iam:members:update")
  @Header("Cache-Control", "no-store, max-age=0")
  public async reissueInvitation(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("memberId") memberId: string,
    @Headers("idempotency-key") requestKey: string | undefined,
  ) {
    if (!requestKey || !/^[A-Za-z0-9._:-]{8,128}$/u.test(requestKey))
      throw new BadRequestException();
    const parsedMemberId = MemberIdSchema.parse(memberId);
    if (!this.activationIssuer || !this.activations) throw new ServiceUnavailableException();
    let reservation;
    try {
      reservation = await this.activations.reserveReissue({
        memberId: parsedMemberId,
        actorMemberId: actor(request).memberId,
        requestKey,
        now: new Date(),
      });
    } catch (error) {
      if (error instanceof IamMemberConflictError) throw new ConflictException();
      throw error;
    }
    if (!reservation) throw new ConflictException("La invitación no se puede reemitir ahora.");
    try {
      const issued = await this.activationIssuer.issue({
        invitationId: reservation.invitationId,
        email: reservation.email,
        displayName: reservation.displayName,
        generation: reservation.generation,
      });
      const recorded = await this.activations.recordIssued({
        invitationId: reservation.invitationId,
        oidcSubject: issued.subject,
        generation: issued.generation,
        expiresAt: new Date(issued.expiresAt),
        now: new Date(),
      });
      if (!recorded || recorded.replayed) throw new ConflictException();
      return InvitationActivationDeliverySchema.parse({
        url: issued.url,
        temporaryPassword: issued.temporaryPassword,
        expiresAt: issued.expiresAt,
      });
    } catch (error) {
      if (error instanceof MemberActivationIssuerError) {
        if (error.reason === "TARGET_CONFLICT") throw new ConflictException();
        throw new ServiceUnavailableException();
      }
      throw error;
    }
  }
}
