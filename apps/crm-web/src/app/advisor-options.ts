/** Invited advisors can own work but cannot sign in until activation. */
export function advisorDisplayName(member: {
  readonly displayName: string;
  readonly status: string;
}): string {
  return member.status === "INVITED"
    ? `${member.displayName} (pendiente de activación)`
    : member.displayName;
}
