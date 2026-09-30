import type { CommercialActor } from "../iam/index.js";

export interface PipelineStage {
  readonly id: string;
  readonly pipelineId: string;
  readonly name: string;
  readonly description: string;
  readonly position: number;
}
export interface Pipeline {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly stages: readonly PipelineStage[];
  readonly createdAt: Date;
}
export interface Opportunity {
  readonly id: string;
  readonly ownerMemberId: string;
  readonly contactId: string;
  readonly pipelineId: string;
  readonly stageId: string;
  readonly title: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: OpportunityStatus;
  readonly closeReason: string | null;
  readonly closedAt: Date | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export type OpportunityStatus = "OPEN" | "WON" | "LOST" | "ABANDONED";
export type OpportunityHistoryEvent =
  "CREATED" | "STAGE_CHANGED" | "UPDATED" | "STATUS_CHANGED" | "OWNER_CHANGED";
export interface OpportunityHistoryEntry {
  readonly id: string;
  readonly opportunityId: string;
  readonly eventType: OpportunityHistoryEvent;
  readonly actorMemberId: string;
  readonly previousStageId: string | null;
  readonly nextStageId: string | null;
  readonly previousOwnerMemberId: string | null;
  readonly nextOwnerMemberId: string | null;
  readonly previousStatus: OpportunityStatus | null;
  readonly nextStatus: OpportunityStatus | null;
  readonly previousAmountMinor: bigint | null;
  readonly nextAmountMinor: bigint | null;
  readonly note: string | null;
  readonly createdAt: Date;
}
export interface OpportunityListFilters {
  readonly contactId?: string | undefined;
  readonly pipelineId?: string | undefined;
  readonly stageId?: string | undefined;
  readonly ownerMemberId?: string | undefined;
  readonly status?: OpportunityStatus | undefined;
  readonly label?: string | undefined;
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
}
export interface SalesContactLookup {
  readonly existsFor: (actor: CommercialActor, contactId: string) => Promise<boolean>;
}
export interface SalesMemberLookup {
  readonly isActive: (memberId: string) => Promise<boolean>;
}

export interface SalesRepository {
  readonly listPipelines: () => Promise<readonly Pipeline[]>;
  readonly createPipeline: (input: {
    readonly pipeline: Pipeline;
    readonly actor: CommercialActor;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<Pipeline>;
  readonly addStage: (input: {
    readonly stage: PipelineStage;
    readonly actor: CommercialActor;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<PipelineStage>;
  readonly listOpportunities: (
    actor: CommercialActor,
    filters?: OpportunityListFilters,
  ) => Promise<readonly Opportunity[]>;
  readonly findOpportunity: (actor: CommercialActor, id: string) => Promise<Opportunity | null>;
  readonly listOpportunityHistory: (
    actor: CommercialActor,
    id: string,
  ) => Promise<readonly OpportunityHistoryEntry[]>;
  readonly findStage: (id: string) => Promise<PipelineStage | null>;
  readonly createOpportunity: (input: {
    readonly opportunity: Opportunity;
    readonly actor: CommercialActor;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<Opportunity>;
  readonly moveOpportunity: (input: {
    readonly actor: CommercialActor;
    readonly id: string;
    readonly stageId: string;
    readonly expectedVersion: bigint;
    readonly now: Date;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<Opportunity | null>;
  readonly updateOpportunity: (input: {
    readonly actor: CommercialActor;
    readonly opportunity: Opportunity;
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<Opportunity | null>;
}
export class SalesValidationError extends Error {
  public constructor() {
    super("Invalid sales state");
    this.name = "SalesValidationError";
  }
}
export class SalesVersionConflictError extends Error {
  public constructor() {
    super("Opportunity has changed");
    this.name = "SalesVersionConflictError";
  }
}
export function validateOpportunityMove(opportunity: Opportunity, stage: PipelineStage): void {
  if (opportunity.pipelineId !== stage.pipelineId) throw new SalesValidationError();
}
export { SalesService, SalesNotFoundError } from "./sales-service.js";
