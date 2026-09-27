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
  /**
   * Internal completion after Keycloak has already validated the one-use
   * activation action. The invitation token and its hash are intentionally
   * not part of this command or any caller-visible result.
   */
  acceptInvitation(input: {
    readonly invitationId: string;
    readonly oidcSubject: string;
    readonly now: Date;
  }): Promise<IamMember | null>;
  bootstrapInitialAdministrator(input: {
    readonly member: IamMember;
    readonly idempotencyKey: string;
  }): Promise<{ readonly member: IamMember; readonly replayed: boolean }>;
}
