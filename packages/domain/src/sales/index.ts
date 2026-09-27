import type { CommercialActor } from "../iam/index.js";

export interface PipelineStage { readonly id: string; readonly pipelineId: string; readonly name: string; readonly description: string; readonly position: number; }
export interface Pipeline { readonly id: string; readonly name: string; readonly description: string; readonly stages: readonly PipelineStage[]; readonly createdAt: Date; }
export interface Opportunity { readonly id: string; readonly ownerMemberId: string; readonly contactId: string; readonly pipelineId: string; readonly stageId: string; readonly title: string; readonly amountMinor: bigint; readonly currency: string; readonly version: bigint; readonly createdAt: Date; readonly updatedAt: Date; }
export interface SalesContactLookup { readonly existsFor: (actor: CommercialActor, contactId: string) => Promise<boolean>; }

export interface SalesRepository {
  readonly listPipelines: () => Promise<readonly Pipeline[]>;
  readonly createPipeline: (input: { readonly pipeline: Pipeline; readonly actor: CommercialActor; readonly idempotencyKey: string; readonly payloadHash: string }) => Promise<Pipeline>;
  readonly addStage: (input: { readonly stage: PipelineStage; readonly actor: CommercialActor; readonly idempotencyKey: string; readonly payloadHash: string }) => Promise<PipelineStage>;
  readonly listOpportunities: (actor: CommercialActor) => Promise<readonly Opportunity[]>;
  readonly findOpportunity: (actor: CommercialActor, id: string) => Promise<Opportunity | null>;
  readonly findStage: (id: string) => Promise<PipelineStage | null>;
  readonly createOpportunity: (input: { readonly opportunity: Opportunity; readonly actor: CommercialActor; readonly idempotencyKey: string; readonly payloadHash: string }) => Promise<Opportunity>;
  readonly moveOpportunity: (input: { readonly actor: CommercialActor; readonly id: string; readonly stageId: string; readonly expectedVersion: bigint; readonly now: Date; readonly idempotencyKey: string; readonly payloadHash: string }) => Promise<Opportunity | null>;
}
export class SalesValidationError extends Error { public constructor() { super("Invalid sales state"); this.name = "SalesValidationError"; } }
export class SalesVersionConflictError extends Error { public constructor() { super("Opportunity has changed"); this.name = "SalesVersionConflictError"; } }
export function validateOpportunityMove(opportunity: Opportunity, stage: PipelineStage): void { if (opportunity.pipelineId !== stage.pipelineId) throw new SalesValidationError(); }
export { SalesService, SalesNotFoundError } from "./sales-service.js";
