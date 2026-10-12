export type AgentCatalogKind = "individual" | "corporativo";
export type AgentSourceStatus = "PENDING" | "INDEXING" | "READY" | "FAILED";

export interface AgentKnowledgeSource {
  readonly id: string;
  readonly catalog: AgentCatalogKind;
  readonly fileId: string | null;
  readonly status: AgentSourceStatus;
  readonly active: boolean;
  readonly revision: string | null;
  readonly createdByMemberId: string;
}

export interface AgentKnowledgeChunk {
  readonly page: number;
  readonly ordinal: number;
  readonly text: string;
}

export interface AgentKnowledgeHit {
  readonly id: string;
  readonly catalog: AgentCatalogKind;
  readonly page: number;
  readonly text: string;
  readonly revision: string;
}

/** Public source contract. The agent runtime never receives this repository. */
export interface AgentKnowledgeRepository {
  readonly createSource: (input: {
    readonly id: string;
    readonly catalog: AgentCatalogKind;
    readonly createdByMemberId: string;
  }) => Promise<AgentKnowledgeSource>;
  readonly findSource: (id: string) => Promise<AgentKnowledgeSource | null>;
  readonly bindFile: (id: string, fileId: string) => Promise<AgentKnowledgeSource>;
  readonly activate: (input: {
    readonly id: string;
    readonly fileId: string;
    readonly revision: string;
    readonly chunks: readonly AgentKnowledgeChunk[];
  }) => Promise<AgentKnowledgeSource>;
  readonly search: (input: {
    readonly catalog: AgentCatalogKind;
    readonly question: string;
    readonly limit: number;
  }) => Promise<readonly AgentKnowledgeHit[]>;
}
