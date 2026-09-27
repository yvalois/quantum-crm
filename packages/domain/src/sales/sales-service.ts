import { randomUUID } from "node:crypto";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import { type Pipeline, type PipelineStage, type SalesContactLookup, type SalesRepository, SalesValidationError, SalesVersionConflictError, validateOpportunityMove } from "./index.js";

export class SalesNotFoundError extends Error { public constructor() { super("Sales resource not found"); this.name = "SalesNotFoundError"; } }
function allow(permissions: readonly IamPermission[], permission: IamPermission): void { if (!permissions.includes(permission)) throw new IamAuthorizationError(); }

export class SalesService {
  public constructor(private readonly repository: SalesRepository, private readonly contacts: SalesContactLookup, private readonly clock: () => Date = () => new Date()) {}
  public listPipelines(permissions: readonly IamPermission[]) { allow(permissions, "crm:sales:read"); return this.repository.listPipelines(); }
  public createPipeline(input: { readonly actor: CommercialActor; readonly permissions: readonly IamPermission[]; readonly name: string; readonly description: string; readonly idempotencyKey: string; readonly payloadHash: string }) {
    allow(input.permissions, "crm:sales:configure");
    const pipeline: Pipeline = Object.freeze({ id: randomUUID(), name: input.name.trim(), description: input.description.trim(), stages: [], createdAt: this.clock() });
    return this.repository.createPipeline({ pipeline, actor: input.actor, idempotencyKey: input.idempotencyKey, payloadHash: input.payloadHash });
  }
  public addStage(input: { readonly actor: CommercialActor; readonly permissions: readonly IamPermission[]; readonly pipelineId: string; readonly name: string; readonly description: string; readonly position: number; readonly idempotencyKey: string; readonly payloadHash: string }) {
    allow(input.permissions, "crm:sales:configure");
    const stage: PipelineStage = Object.freeze({ id: randomUUID(), pipelineId: input.pipelineId, name: input.name.trim(), description: input.description.trim(), position: input.position });
    return this.repository.addStage({ stage, actor: input.actor, idempotencyKey: input.idempotencyKey, payloadHash: input.payloadHash });
  }
  public listOpportunities(actor: CommercialActor, permissions: readonly IamPermission[]) { allow(permissions, "crm:sales:read"); return this.repository.listOpportunities(actor); }
  public createOpportunity(input: { readonly actor: CommercialActor; readonly permissions: readonly IamPermission[]; readonly contactId: string; readonly pipelineId: string; readonly stageId: string; readonly title: string; readonly amountMinor: bigint; readonly currency: string; readonly idempotencyKey: string; readonly payloadHash: string }) {
    allow(input.permissions, "crm:sales:create");
    if (input.amountMinor < 0n || !/^[A-Z]{3}$/u.test(input.currency)) throw new SalesValidationError();
    return Promise.all([this.contacts.existsFor(input.actor, input.contactId), this.repository.findStage(input.stageId)]).then(([contactExists, stage]) => {
      if (!contactExists || !stage || stage.pipelineId !== input.pipelineId) throw new SalesValidationError();
      const now = this.clock();
      return this.repository.createOpportunity({ opportunity: Object.freeze({ id: randomUUID(), ownerMemberId: input.actor.memberId, contactId: input.contactId, pipelineId: input.pipelineId, stageId: input.stageId, title: input.title.trim(), amountMinor: input.amountMinor, currency: input.currency, version: 1n, createdAt: now, updatedAt: now }), actor: input.actor, idempotencyKey: input.idempotencyKey, payloadHash: input.payloadHash });
    });
  }
  public async moveOpportunity(input: { readonly actor: CommercialActor; readonly permissions: readonly IamPermission[]; readonly opportunityId: string; readonly stageId: string; readonly expectedVersion: bigint; readonly idempotencyKey: string; readonly payloadHash: string }) {
    allow(input.permissions, "crm:sales:move");
    const opportunity = await this.repository.findOpportunity(input.actor, input.opportunityId);
    if (!opportunity) throw new SalesNotFoundError();
    if (opportunity.version !== input.expectedVersion) throw new SalesVersionConflictError();
    const stage = await this.repository.findStage(input.stageId);
    if (!stage) throw new SalesNotFoundError();
    validateOpportunityMove(opportunity, stage);
    const result = await this.repository.moveOpportunity({ actor: input.actor, id: input.opportunityId, stageId: stage.id, expectedVersion: input.expectedVersion, now: this.clock(), idempotencyKey: input.idempotencyKey, payloadHash: input.payloadHash });
    if (!result) throw new SalesVersionConflictError();
    return result;
  }
}
