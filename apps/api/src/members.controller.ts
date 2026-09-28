import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  PreconditionFailedException,
  HttpException,
  HttpStatus,
  Query,
  Req,
} from "@nestjs/common";
import {
  CreateMemberInvitationSchema,
  InvitationResponseSchema,
  MemberIdSchema,
  MemberListQuerySchema,
  MemberListResponseSchema,
  MemberResponseSchema,
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

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const IAM_MEMBER_SERVICE = Symbol("IAM_MEMBER_SERVICE");

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
  public constructor(@Inject(IAM_MEMBER_SERVICE) private readonly service: IamMemberService) {}

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
      })),
      page: { nextCursor: result.nextCursor },
    });
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
      return InvitationResponseSchema.parse({
        data: {
          id: result.invitation.id,
          memberId: result.invitation.memberId,
          status: result.invitation.status,
          expiresAt: result.invitation.expiresAt.toISOString(),
          acceptedAt: result.invitation.acceptedAt?.toISOString() ?? null,
          createdAt: result.invitation.createdAt.toISOString(),
        },
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
}
