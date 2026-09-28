import type { CommercialScope, IamInvitation, IamMember, RoleCode } from "../domain/member.js";

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
    readonly roleCode: RoleCode;
  }): Promise<{
    readonly member: IamMember;
    readonly invitation: IamInvitation;
    readonly replayed: boolean;
  }>;
  update(member: IamMember, expectedAuthorizationRevision?: bigint): Promise<IamMember>;
  updateCommercialScope?(input: {
    readonly memberId: string;
    readonly scope: Exclude<CommercialScope, "OWN">;
    readonly now: Date;
    readonly expectedAuthorizationRevision: bigint;
  }): Promise<IamMember | null>;
  assignRole(input: {
    readonly memberId: string;
    readonly roleCode: RoleCode;
    readonly now: Date;
  }): Promise<IamMember | null>;
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
  /** Completes the pending invitation bound to a subject after OIDC required actions succeed. */
  acceptInvitationForSubject?(input: {
    readonly oidcSubject: string;
    readonly now: Date;
  }): Promise<IamMember | null>;
  /** Revokes a pending invitation without deleting its member history. */
  revokeInvitation?(input: {
    readonly memberId: string;
    readonly now: Date;
  }): Promise<IamInvitation | null>;
  bootstrapInitialAdministrator(input: {
    readonly member: IamMember;
    readonly idempotencyKey: string;
  }): Promise<{ readonly member: IamMember; readonly replayed: boolean }>;
}
