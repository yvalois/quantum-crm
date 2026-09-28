import { randomUUID } from "node:crypto";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";

export type AutomationStatus = "DRAFT" | "ACTIVE" | "PAUSED";
export interface AutomationAction {
  readonly type: "CREATE_TASK";
  readonly title: string;
  readonly description: string;
  readonly priority: "LOW" | "MEDIUM" | "HIGH";
  readonly dueHours: number;
}
export interface AutomationDefinition {
  readonly id: string;
  readonly name: string;
  readonly status: AutomationStatus;
  readonly triggerEvent: "CONTACT_MANUAL";
  readonly action: AutomationAction;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface AutomationExecutionResult {
  readonly executionId: string;
  readonly contactId: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly taskId: string | null;
  readonly errorCode: string | null;
}
export interface AutomationActivationResult {
  readonly automationId: string;
  readonly operationKey: string;
  readonly results: readonly AutomationExecutionResult[];
  readonly succeeded: number;
  readonly failed: number;
}
export interface AutomationRepository {
  readonly list: () => Promise<readonly AutomationDefinition[]>;
  readonly create: (input: {
    readonly automation: AutomationDefinition;
    readonly actor: CommercialActor;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<AutomationDefinition>;
  readonly activate: (input: {
    readonly actor: CommercialActor;
    readonly automationId: string;
    readonly contactIds: readonly string[];
    readonly operationKey: string;
    readonly payloadHash: string;
  }) => Promise<AutomationActivationResult>;
}
export class AutomationNotFoundError extends Error {
  public constructor() {
    super("Automation not found");
    this.name = "AutomationNotFoundError";
  }
}
export class AutomationValidationError extends Error {
  public constructor() {
    super("Invalid automation");
    this.name = "AutomationValidationError";
  }
}

function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

export class AutomationService {
  public constructor(
    private readonly repository: AutomationRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public list(permissions: readonly IamPermission[]) {
    allow(permissions, "crm:automations:read");
    return this.repository.list();
  }

  public create(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly name: string;
    readonly status: AutomationStatus;
    readonly action: AutomationAction;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:automations:configure");
    if (
      !input.name.trim() ||
      input.name.trim().length > 160 ||
      !input.action.title.trim() ||
      !input.action.description.trim() ||
      !Number.isInteger(input.action.dueHours) ||
      input.action.dueHours < 1
    )
      throw new AutomationValidationError();
    const now = this.clock();
    if (Number.isNaN(now.getTime())) throw new AutomationValidationError();
    return this.repository.create({
      actor: input.actor,
      automation: Object.freeze({
        id: randomUUID(),
        name: input.name.trim(),
        status: input.status,
        triggerEvent: "CONTACT_MANUAL",
        action: Object.freeze({ ...input.action, title: input.action.title.trim() }),
        version: 1n,
        createdAt: now,
        updatedAt: now,
      }),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }

  public activate(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly automationId: string;
    readonly contactIds: readonly string[];
    readonly operationKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:automations:execute");
    allow(input.permissions, "crm:tasks:create");
    const contactIds = [...new Set(input.contactIds)];
    if (contactIds.length === 0 || contactIds.length > 500) throw new AutomationValidationError();
    return this.repository.activate({ ...input, contactIds });
  }
}
