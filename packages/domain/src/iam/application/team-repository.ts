import type { IamTeam } from "../domain/team.js";

export interface IamTeamRepository {
  list(): Promise<readonly IamTeam[]>;
  create(team: IamTeam): Promise<IamTeam | null>;
  addMember(teamId: string, memberId: string): Promise<IamTeam | null>;
  removeMember(teamId: string, memberId: string): Promise<IamTeam | null>;
}
