import { UnifiedInboxListQuerySchema, type UnifiedInboxListQuery } from "@quantum-crm/contracts";
import {
  IamAuthorizationError,
  withSourceParticipants,
  type CommercialActor,
  type ExternalParticipantLookup,
  type IamPermission,
} from "../iam/index.js";
import { ConversationValidationError, type ConversationRecord } from "./index.js";
import type { HistoricalThreadRecord } from "./historical-conversation-service.js";

export type UnifiedInboxRecord =
  | { readonly source: "QUANTUM"; readonly conversation: ConversationRecord }
  | { readonly source: "GHL"; readonly conversation: HistoricalThreadRecord };
export interface UnifiedInboxPage {
  readonly items: readonly UnifiedInboxRecord[];
  readonly nextCursor: string | null;
}
export interface UnifiedInboxRepository {
  readonly list: (actor: CommercialActor, query: UnifiedInboxListQuery) => Promise<UnifiedInboxPage>;
}

export class UnifiedInboxService {
  public constructor(
    private readonly repository: UnifiedInboxRepository,
    private readonly participants?: ExternalParticipantLookup,
  ) {}

  public async list(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    query: UnifiedInboxListQuery,
  ): Promise<UnifiedInboxPage> {
    if (!permissions.includes("crm:conversations:read")) throw new IamAuthorizationError();
    const parsed = UnifiedInboxListQuerySchema.safeParse(query);
    if (!parsed.success) throw new ConversationValidationError();
    const page = await this.repository.list(actor, parsed.data);
    // Resolve source names only after the owning repository has applied each resource's scope.
    const history = await withSourceParticipants(
      page.items.flatMap((item) => item.source === "GHL" ? [item.conversation] : []),
      this.participants,
    );
    const indexed = new Map(history.map((conversation) => [conversation.id, conversation]));
    return {
      ...page,
      items: page.items.map((item) => item.source === "GHL"
        ? { source: "GHL", conversation: indexed.get(item.conversation.id)! }
        : item),
    };
  }
}
