import { IamAuthorizationError, type IamPermission } from "../iam/index.js";
import { ConversationVersionConflictError } from "./index.js";

export interface AgentControlState {
  readonly enabled: boolean;
  readonly version: bigint;
  readonly updatedAt: Date;
}

export interface AgentControlRepository {
  readonly get: () => Promise<AgentControlState>;
  readonly set: (input: {
    readonly enabled: boolean;
    readonly expectedVersion: bigint;
    readonly actorMemberId: string;
  }) => Promise<AgentControlState | null>;
}

/** Profile-scoped switch: chat-level HUMAN mode remains independent. */
export class AgentControlService {
  public constructor(private readonly repository: AgentControlRepository) {}

  public get(permissions: readonly IamPermission[]): Promise<AgentControlState> {
    if (!permissions.includes("crm:conversations:read")) throw new IamAuthorizationError();
    return this.repository.get();
  }

  public async set(input: {
    readonly permissions: readonly IamPermission[];
    readonly actorMemberId: string;
    readonly expectedVersion: bigint;
    readonly enabled: boolean;
  }): Promise<AgentControlState> {
    if (!input.permissions.includes("crm:conversations:configure"))
      throw new IamAuthorizationError();
    const result = await this.repository.set(input);
    if (!result) throw new ConversationVersionConflictError();
    return result;
  }
}
