import type { IamPermission, IamRole } from "../domain/member.js";

export interface IamRoleRepository {
  list(): Promise<readonly IamRole[]>;
  findById(roleId: string): Promise<IamRole | null>;
  create(role: IamRole): Promise<IamRole>;
  update(role: IamRole): Promise<IamRole | null>;
}

export type IamRoleUpdate = {
  readonly displayName?: string;
  readonly permissions?: readonly IamPermission[];
};
