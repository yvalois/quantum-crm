import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  CreateRoleSchema,
  RoleIdSchema,
  RoleListResponseSchema,
  RoleResponseSchema,
  UpdateRoleSchema,
} from "@quantum-crm/contracts";
import {
  IamAuthorizationError,
  IamMemberValidationError,
  IamRoleNotFoundError,
  IamRoleService,
  type IamRole,
  type IamPermission,
} from "@quantum-crm/domain";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const IAM_ROLE_SERVICE = Symbol("IAM_ROLE_SERVICE");

function actor(request: Parameters<typeof crmAuthContext>[0]) {
  const context = crmAuthContext(request);
  return Object.freeze({
    memberId: context.principal.id,
    permissions: context.permissions as readonly IamPermission[],
  });
}

function roleResponse(role: IamRole) {
  return {
    id: role.id,
    code: role.code,
    displayName: role.displayName,
    system: role.system,
    authorizationRevision: role.authorizationRevision.toString(),
    permissions: [...role.permissions],
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

function mapRoleError(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof IamRoleNotFoundError) throw new NotFoundException();
  if (error instanceof IamMemberValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/roles")
export class RolesController {
  public constructor(@Inject(IAM_ROLE_SERVICE) private readonly service: IamRoleService) {}

  @Get()
  @RequireCrmPermission("iam:members:roles")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      return RoleListResponseSchema.parse({
        data: (await this.service.list(actor(request))).map(roleResponse),
      });
    } catch (error) {
      return mapRoleError(error);
    }
  }

  @Post()
  @RequireCrmPermission("iam:members:roles")
  public async create(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Body() body: unknown,
  ) {
    try {
      const input = CreateRoleSchema.parse(body);
      return RoleResponseSchema.parse({ data: roleResponse(await this.service.create({ ...input, actor: actor(request) })) });
    } catch (error) {
      return mapRoleError(error);
    }
  }

  @Patch(":roleId")
  @RequireCrmPermission("iam:members:roles")
  public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("roleId") roleId: string,
    @Body() body: unknown,
  ) {
    try {
      const input = UpdateRoleSchema.parse(body);
      return RoleResponseSchema.parse({
        data: roleResponse(
          await this.service.update({
            actor: actor(request),
            roleId: RoleIdSchema.parse(roleId),
            ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
            ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
          }),
        ),
      });
    } catch (error) {
      return mapRoleError(error);
    }
  }
}
