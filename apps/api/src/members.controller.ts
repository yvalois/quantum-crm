import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import {
  MemberListQuerySchema,
  MemberListResponseSchema,
  type MemberListResponse,
} from "@quantum-crm/contracts";
import { IamMemberService, type IamPermission } from "@quantum-crm/domain";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const IAM_MEMBER_SERVICE = Symbol("IAM_MEMBER_SERVICE");

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
    const context = crmAuthContext(request);
    const result = await this.service.list(
      {
        memberId: context.principal.id,
        permissions: context.permissions as readonly IamPermission[],
      },
      criteria,
    );
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
      })),
      page: { nextCursor: result.nextCursor },
    });
  }
}
