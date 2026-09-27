import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  AddTeamMemberSchema,
  CreateTeamSchema,
  TeamIdSchema,
  TeamListResponseSchema,
  TeamResponseSchema,
} from "@quantum-crm/contracts";
import {
  IamAuthorizationError,
  IamTeamConflictError,
  IamTeamMemberNotFoundError,
  IamTeamNotFoundError,
  IamTeamService,
  IamTeamValidationError,
  type IamPermission,
  type IamTeam,
} from "@quantum-crm/domain";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const IAM_TEAM_SERVICE = Symbol("IAM_TEAM_SERVICE");

function actor(request: Parameters<typeof crmAuthContext>[0]) {
  const context = crmAuthContext(request);
  return Object.freeze({
    memberId: context.principal.id,
    permissions: context.permissions as readonly IamPermission[],
  });
}

function teamResponse(team: IamTeam) {
  return TeamResponseSchema.parse({
    data: {
      id: team.id,
      name: team.name,
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
      members: team.members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        email: member.email,
        status: member.status,
      })),
    },
  });
}

function mapTeamError(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof IamTeamNotFoundError || error instanceof IamTeamMemberNotFoundError) {
    throw new NotFoundException();
  }
  if (error instanceof IamTeamConflictError) throw new ConflictException();
  if (error instanceof IamTeamValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/teams")
export class TeamsController {
  public constructor(@Inject(IAM_TEAM_SERVICE) private readonly service: IamTeamService) {}

  @Get()
  @RequireCrmPermission("iam:teams:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      return TeamListResponseSchema.parse({
        data: (await this.service.list(actor(request))).map((team) => teamResponse(team).data),
      });
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @Post()
  @RequireCrmPermission("iam:teams:create")
  public async create(@Req() request: Parameters<typeof crmAuthContext>[0], @Body() body: unknown) {
    try {
      const input = CreateTeamSchema.parse(body);
      return teamResponse(await this.service.create({ actor: actor(request), name: input.name }));
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @Post(":teamId/members")
  @RequireCrmPermission("iam:teams:update")
  public async addMember(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("teamId") teamId: string,
    @Body() body: unknown,
  ) {
    try {
      const input = AddTeamMemberSchema.parse(body);
      return teamResponse(
        await this.service.addMember({
          actor: actor(request),
          teamId: TeamIdSchema.parse(teamId),
          memberId: input.memberId,
        }),
      );
    } catch (error) {
      return mapTeamError(error);
    }
  }

  @Delete(":teamId/members/:memberId")
  @RequireCrmPermission("iam:teams:update")
  public async removeMember(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("teamId") teamId: string,
    @Param("memberId") memberId: string,
  ) {
    try {
      return teamResponse(
        await this.service.removeMember({
          actor: actor(request),
          teamId: TeamIdSchema.parse(teamId),
          memberId: TeamIdSchema.parse(memberId),
        }),
      );
    } catch (error) {
      return mapTeamError(error);
    }
  }
}
