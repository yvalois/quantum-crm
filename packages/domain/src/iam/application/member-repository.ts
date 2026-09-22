import type { IamInvitation, IamMember, InitialRoleCode } from "../domain/member.js";

export interface IamMemberPage {
  readonly members: readonly IamMember[];
  readonly nextCursor: string | null;
}

export interface IamMemberRepository {
  list(input: {
    readonly cursor?: string;
    readonly limit: number;
    readonly status?: IamMember["status"];
  }): Promise<IamMemberPage>;
  findById(memberId: string): Promise<IamMember | null>;
  findByOidcSubject(oidcSubject: string): Promise<IamMember | null>;
  createInvitation(input: {
    readonly member: IamMember;
    readonly invitation: IamInvitation;
    readonly invitationTokenHash: string;
    readonly createdByMemberId: string;
    readonly idempotencyKey: string;
    readonly roleCode: InitialRoleCode;
  }): Promise<{
    readonly member: IamMember;
    readonly invitation: IamInvitation;
    readonly replayed: boolean;
  }>;
  update(member: IamMember): Promise<IamMember>;
  acceptInvitation(input: {
    readonly invitationId: string;
    readonly invitationTokenHash: string;
    readonly oidcSubject: string;
    readonly now: Date;
  }): Promise<IamMember | null>;
}
