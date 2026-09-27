const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type IamTeamMemberStatus = "INVITED" | "ACTIVE" | "DEACTIVATED";

export interface IamTeamMember {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly status: IamTeamMemberStatus;
}

export interface IamTeam {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly members: readonly IamTeamMember[];
}

export class IamTeamValidationError extends Error {
  public constructor() {
    super("Invalid IAM team state");
    this.name = "IamTeamValidationError";
  }
}

export function createIamTeam(input: {
  readonly id: string;
  readonly name: string;
  readonly now: Date;
}): IamTeam {
  if (!uuidPattern.test(input.id) || !(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new IamTeamValidationError();
  }
  const name = input.name.trim();
  if (name.length < 1 || name.length > 160) throw new IamTeamValidationError();
  return Object.freeze({
    id: input.id,
    name,
    createdAt: input.now,
    updatedAt: input.now,
    members: Object.freeze([]),
  });
}
