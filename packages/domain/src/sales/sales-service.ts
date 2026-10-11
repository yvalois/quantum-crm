import { randomUUID } from "node:crypto";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import {
  type Pipeline,
  type PipelineStage,
  type SalesContactLookup,
  type SalesMemberLookup,
  type SalesRepository,
  SalesValidationError,
  SalesVersionConflictError,
  validateOpportunityMove,
} from "./index.js";

export class SalesNotFoundError extends Error {
  public constructor() {
    super("Sales resource not found");
    this.name = "SalesNotFoundError";
  }
}
function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

export class SalesService {
  public constructor(
    private readonly repository: SalesRepository,
    private readonly contacts: SalesContactLookup,
    private readonly members: SalesMemberLookup = { isActive: async () => false },
    private readonly clock: () => Date = () => new Date(),
  ) {}
  public listPipelines(permissions: readonly IamPermission[]) {
    allow(permissions, "crm:sales:read");
    return this.repository.listPipelines();
  }
  public createPipeline(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly name: string;
    readonly description: string;
    readonly stages?:
      | readonly {
          readonly name: string;
          readonly description: string;
        }[]
      | undefined;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:sales:configure");
    if (input.stages && (input.stages.length < 1 || input.stages.length > 25))
      throw new SalesValidationError();
    const pipelineId = randomUUID();
    const stageNames = new Set<string>();
    const stages = Object.freeze(
      (input.stages ?? []).map((stage, position) => {
        const name = stage.name.trim();
        const description = stage.description.trim();
        const normalizedName = name.normalize("NFKC").toLowerCase();
        if (!name || !description || stageNames.has(normalizedName))
          throw new SalesValidationError();
        stageNames.add(normalizedName);
        return Object.freeze({
          id: randomUUID(),
          pipelineId,
          name,
          description,
          position,
        });
      }),
    );
    const pipeline: Pipeline = Object.freeze({
      id: pipelineId,
      name: input.name.trim(),
      description: input.description.trim(),
      stages,
      createdAt: this.clock(),
    });
    return this.repository.createPipeline({
      pipeline,
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }
  public addStage(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly pipelineId: string;
    readonly name: string;
    readonly description: string;
    readonly position: number;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:sales:configure");
    const stage: PipelineStage = Object.freeze({
      id: randomUUID(),
      pipelineId: input.pipelineId,
      name: input.name.trim(),
      description: input.description.trim(),
      position: input.position,
    });
    return this.repository.addStage({
      stage,
      actor: input.actor,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }
  public listOpportunities(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    filters: Parameters<SalesRepository["listOpportunities"]>[1] = {},
  ) {
    allow(permissions, "crm:sales:read");
    return this.repository.listOpportunities(actor, filters);
  }
  public listOpportunityHistory(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly opportunityId: string;
  }) {
    allow(input.permissions, "crm:sales:read");
    return this.repository.listOpportunityHistory(input.actor, input.opportunityId);
  }
  public createOpportunity(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly contactId: string;
    readonly pipelineId: string;
    readonly stageId: string;
    readonly ownerMemberId?: string | undefined;
    readonly title: string;
    readonly amountMinor: bigint;
    readonly currency: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:sales:create");
    if (input.amountMinor < 0n || !/^[A-Z]{3}$/u.test(input.currency))
      throw new SalesValidationError();
    return Promise.all([
      this.contacts.existsFor(input.actor, input.contactId),
      this.repository.findStage(input.stageId),
      input.ownerMemberId && input.ownerMemberId !== input.actor.memberId
        ? this.members.isActive(input.ownerMemberId)
        : Promise.resolve(true),
    ]).then(([contactExists, stage, ownerIsActive]) => {
      if (!contactExists || !stage || stage.pipelineId !== input.pipelineId)
        throw new SalesValidationError();
      if (!ownerIsActive) throw new SalesValidationError();
      const now = this.clock();
      return this.repository.createOpportunity({
        opportunity: Object.freeze({
          id: randomUUID(),
          ownerMemberId: input.ownerMemberId ?? input.actor.memberId,
          contactId: input.contactId,
          pipelineId: input.pipelineId,
          stageId: input.stageId,
          title: input.title.trim(),
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: "OPEN",
          closeReason: null,
          closedAt: null,
          version: 1n,
          createdAt: now,
          updatedAt: now,
        }),
        actor: input.actor,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
      });
    });
  }
  public async updateOpportunity(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly opportunityId: string;
    readonly expectedVersion: bigint;
    readonly title?: string | undefined;
    readonly amountMinor?: bigint | undefined;
    readonly currency?: string | undefined;
    readonly ownerMemberId?: string | undefined;
    readonly status?: "OPEN" | "WON" | "LOST" | "ABANDONED" | undefined;
    readonly closeReason?: string | null | undefined;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:sales:update");
    const current = await this.repository.findOpportunity(input.actor, input.opportunityId);
    if (!current) throw new SalesNotFoundError();
    if (current.version !== input.expectedVersion) throw new SalesVersionConflictError();
    const ownerMemberId = input.ownerMemberId ?? current.ownerMemberId;
    if (ownerMemberId !== current.ownerMemberId && !(await this.members.isActive(ownerMemberId)))
      throw new SalesValidationError();
    const amountMinor = input.amountMinor ?? current.amountMinor;
    const currency = input.currency ?? current.currency;
    if (amountMinor < 0n || !/^[A-Z]{3}$/u.test(currency)) throw new SalesValidationError();
    const status = input.status ?? current.status;
    const requestedReason =
      input.closeReason === undefined ? current.closeReason : input.closeReason;
    const closeReason =
      status === "LOST" || status === "ABANDONED" ? requestedReason?.trim() : null;
    if ((status === "LOST" || status === "ABANDONED") && !closeReason)
      throw new SalesValidationError();
    const now = this.clock();
    const closedAt =
      status === "OPEN"
        ? null
        : current.status === status && current.closedAt !== null
          ? current.closedAt
          : now;
    const title = input.title?.trim() ?? current.title;
    if (!title) throw new SalesValidationError();
    const result = await this.repository.updateOpportunity({
      actor: input.actor,
      opportunity: Object.freeze({
        ...current,
        ownerMemberId,
        title,
        amountMinor,
        currency,
        status,
        closeReason: closeReason ?? null,
        closedAt,
        version: current.version + 1n,
        updatedAt: now,
      }),
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new SalesVersionConflictError();
    return result;
  }
  public async moveOpportunity(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly opportunityId: string;
    readonly stageId: string;
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:sales:move");
    const opportunity = await this.repository.findOpportunity(input.actor, input.opportunityId);
    if (!opportunity) throw new SalesNotFoundError();
    if (opportunity.version !== input.expectedVersion) throw new SalesVersionConflictError();
    const stage = await this.repository.findStage(input.stageId);
    if (!stage) throw new SalesNotFoundError();
    validateOpportunityMove(opportunity, stage);
    const result = await this.repository.moveOpportunity({
      actor: input.actor,
      id: input.opportunityId,
      stageId: stage.id,
      expectedVersion: input.expectedVersion,
      now: this.clock(),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new SalesVersionConflictError();
    return result;
  }
}
