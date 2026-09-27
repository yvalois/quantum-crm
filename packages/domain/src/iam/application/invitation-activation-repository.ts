/**
 * Durable, non-secret correlation between an IAM invitation and the Keycloak
 * action issued for it.  It deliberately contains neither an action URL nor a
 * token: both remain ephemeral at the identity-delivery boundary.
 */
export interface IamInvitationActivation {
  readonly invitationId: string;
  readonly oidcSubject: string;
  readonly generation: number;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface IamInvitationActivationRepository {
  /**
   * Records one Keycloak action generation after its user has been reconciled.
   * Replaying the same generation and subject returns the prior record; a
   * different subject or a skipped generation conflicts.
   */
  recordIssued(input: {
    readonly invitationId: string;
    readonly oidcSubject: string;
    readonly generation: number;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<{ readonly activation: IamInvitationActivation; readonly replayed: boolean } | null>;
}
