import { describe, expect, it, vi } from "vitest";

import {
  createProvisioningOperationDraft,
  evaluateProvisioningValidation,
  hydrateProvisioningOperation,
  ProvisioningOperationValidationError,
  TenantProvisioningService,
  validateProvisioningLeaseClaim,
  validateProvisioningLeaseRenewal,
  validateCompleteProvisioningContainers,
  validateCompleteProvisioningHttps,
  validateCompleteProvisioningMigration,
  provisioningOperationSteps,
  type ProvisioningOperationRepository,
} from "./provisioning-operation.js";

const command = {
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  requestedByOperatorId: "01995f7e-7b52-7000-8000-000000000101",
  idempotencyKey: "provision-acme-001",
  correlationId: "request-001",
  requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
  expectedTenantVersion: 1n,
} as const;

describe("tenant provisioning operation", () => {
  it("requires the written configuration before CRM migration and containers", () => {
    expect(provisioningOperationSteps.indexOf("WRITE_CONFIGURATION")).toBeLessThan(
      provisioningOperationSteps.indexOf("MIGRATE_DATABASE"),
    );
    expect(provisioningOperationSteps.indexOf("MIGRATE_DATABASE")).toBeLessThan(
      provisioningOperationSteps.indexOf("START_CONTAINERS"),
    );
  });

  it("fences a per-tenant CRM migration completion with operation lease identity", () => {
    expect(
      validateCompleteProvisioningMigration({
        operationId: "01995f7e-7b52-7000-8000-000000000401",
        tenantProfileId: command.tenantProfileId,
        workerId: "deploy-executor:test",
        expectedVersion: 2n,
        attempt: 1,
      }),
    ).toMatchObject({ expectedVersion: 2n, attempt: 1 });
    expect(() =>
      validateCompleteProvisioningMigration({
        operationId: "invalid",
        tenantProfileId: command.tenantProfileId,
        workerId: "deploy-executor:test",
        expectedVersion: 2n,
        attempt: 1,
      }),
    ).toThrow(ProvisioningOperationValidationError);
  });
  it("creates a closed pending operation draft", () => {
    expect(createProvisioningOperationDraft(command)).toEqual({
      tenantProfileId: command.tenantProfileId,
      serverId: command.serverId,
      releaseId: command.releaseId,
      requestedByOperatorId: command.requestedByOperatorId,
      idempotencyKey: command.idempotencyKey,
      correlationId: command.correlationId,
      requestedCapacity: command.requestedCapacity,
      status: "PENDING",
      currentStep: "VALIDATE",
    });
  });

  it.each([
    ["tenantProfileId", { tenantProfileId: "bad" }],
    ["serverId", { serverId: "bad" }],
    ["releaseId", { releaseId: "bad" }],
    ["requestedByOperatorId", { requestedByOperatorId: "bad" }],
    ["idempotencyKey", { idempotencyKey: "short" }],
    ["correlationId", { correlationId: "contains space" }],
    [
      "requestedCapacity.cpuMillicores",
      { requestedCapacity: { cpuMillicores: 0, memoryMiB: 1, storageMiB: 1 } },
    ],
  ] as const)("rejects invalid %s", (field, overrides) => {
    expect(() => createProvisioningOperationDraft({ ...command, ...overrides })).toThrow(
      new ProvisioningOperationValidationError(field),
    );
  });

  it("validates before delegating to the durable repository", async () => {
    const request = vi.fn(async () => ({
      operation: {} as never,
      tenantVersion: 2n,
      idempotentReplay: false,
    }));
    const service = new TenantProvisioningService({
      request,
      claimNext: vi.fn(),
      renewLease: vi.fn(),
      completeValidation: vi.fn(),
      completeDatabase: vi.fn(),
      completeSecrets: vi.fn(),
      completeMigration: vi.fn(),
      completeStorage: vi.fn(),
      completeConfiguration: vi.fn(),
      completeContainers: vi.fn(),
      completeHttps: vi.fn(),
      resolveHttpsContext: vi.fn(),
      resolveIdentityContext: vi.fn(),
      resolveInitialAdministratorContext: vi.fn(),
      completeInitialAdministrator: vi.fn(),
      completeVerification: vi.fn(),
      completeActivation: vi.fn(),
    } satisfies ProvisioningOperationRepository);
    await expect(service.request(command)).resolves.toMatchObject({ tenantVersion: 2n });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING" }));
  });

  it("hydrates a running operation only with a coherent durable lease", () => {
    const operation = hydrateProvisioningOperation({
      ...command,
      id: "01995f7e-7b52-7000-8000-000000000401",
      status: "RUNNING",
      currentStep: "VALIDATE",
      attempt: 1,
      version: 2n,
      failureCode: null,
      lease: {
        owner: "executor-01",
        lastHeartbeatAt: new Date("2026-09-20T12:00:00.000Z"),
        expiresAt: new Date("2026-09-20T12:01:00.000Z"),
      },
      createdAt: new Date("2026-09-20T11:59:00.000Z"),
      updatedAt: new Date("2026-09-20T12:00:00.000Z"),
      capacityReservation: {
        id: "01995f7e-7b52-7000-8000-000000000501",
        capacity: command.requestedCapacity,
      },
    });

    expect(operation).toMatchObject({
      status: "RUNNING",
      attempt: 1,
      lease: { owner: "executor-01" },
    });
    expect(Object.isFrozen(operation.lease)).toBe(true);
  });

  it("rejects inconsistent lease state and invalid fencing commands", () => {
    expect(() =>
      hydrateProvisioningOperation({
        ...command,
        id: "01995f7e-7b52-7000-8000-000000000401",
        status: "RUNNING",
        currentStep: "VALIDATE",
        attempt: 1,
        version: 2n,
        failureCode: null,
        lease: null,
        createdAt: new Date("2026-09-20T11:59:00.000Z"),
        updatedAt: new Date("2026-09-20T12:00:00.000Z"),
        capacityReservation: {
          id: "01995f7e-7b52-7000-8000-000000000501",
          capacity: command.requestedCapacity,
        },
      }),
    ).toThrow(new ProvisioningOperationValidationError("lease"));
    expect(() =>
      validateProvisioningLeaseClaim({
        workerId: "executor 01",
        leaseDurationSeconds: 60,
        supportedSteps: ["VALIDATE"],
      }),
    ).toThrow(new ProvisioningOperationValidationError("workerId"));
    expect(() =>
      validateProvisioningLeaseRenewal({
        operationId: "01995f7e-7b52-7000-8000-000000000401",
        workerId: "executor-01",
        leaseDurationSeconds: 60,
        expectedVersion: 0n,
      }),
    ).toThrow(new ProvisioningOperationValidationError("expectedVersion"));
  });

  it("validates the fenced container observation", () => {
    const valid = validateCompleteProvisioningContainers({
      operationId: "01995f7e-7b52-7000-8000-000000000401",
      tenantProfileId: command.tenantProfileId,
      serverId: command.serverId,
      releaseId: command.releaseId,
      workerId: "executor-01",
      expectedVersion: 2n,
      attempt: 1,
      manifestRef: `tenant/${command.tenantProfileId}/configuration.json`,
      configurationRevision: 1n,
      projectName: `qcrm-t-${command.tenantProfileId}`,
      services: ["agent-runtime", "api", "crm-web", "portal-web", "worker"],
      ready: true,
      reconciled: false,
    });
    expect(valid.services).toEqual(["agent-runtime", "api", "crm-web", "portal-web", "worker"]);
    expect(() =>
      validateCompleteProvisioningContainers({ ...valid, projectName: "unsafe" }),
    ).toThrow(new ProvisioningOperationValidationError("projectName"));
  });

  it("validates a configured HTTPS route observation", () => {
    const valid = validateCompleteProvisioningHttps({
      operationId: "01995f7e-7b52-7000-8000-000000000401",
      tenantProfileId: command.tenantProfileId,
      serverId: command.serverId,
      releaseId: command.releaseId,
      workerId: "executor-01",
      expectedVersion: 3n,
      attempt: 1,
      hostname: "acme.2-25-172-119.nip.io",
      edgeNetworkName: `qcrm-tenant-edge-${command.tenantProfileId}`,
      upstreamServices: ["api", "crm-web", "portal-web"],
      configurationRevision: 1n,
      routeGeneration: 1n,
      configured: true,
      reconciled: true,
    });
    expect(valid.upstreamServices).toEqual(["api", "crm-web", "portal-web"]);
    expect(() => validateCompleteProvisioningHttps({ ...valid, configured: false })).toThrow(
      new ProvisioningOperationValidationError("configured"),
    );
  });

  it("evaluates the durable validation snapshot with closed failure codes", () => {
    const operation = hydrateProvisioningOperation({
      ...command,
      id: "01995f7e-7b52-7000-8000-000000000401",
      status: "RUNNING",
      currentStep: "VALIDATE",
      attempt: 1,
      version: 2n,
      failureCode: null,
      lease: {
        owner: "executor-01",
        lastHeartbeatAt: new Date("2026-09-20T12:00:00.000Z"),
        expiresAt: new Date("2026-09-20T12:01:00.000Z"),
      },
      createdAt: new Date("2026-09-20T11:59:00.000Z"),
      updatedAt: new Date("2026-09-20T12:00:00.000Z"),
      capacityReservation: {
        id: "01995f7e-7b52-7000-8000-000000000501",
        capacity: command.requestedCapacity,
      },
    });
    const snapshot = {
      tenant: {
        status: "PROVISIONING" as const,
        serverId: command.serverId,
        releaseId: command.releaseId,
      },
      server: { status: "AVAILABLE" as const, reservedCapacity: command.requestedCapacity },
      release: { status: "VALIDATED" as const },
      reservation: {
        tenantProfileId: command.tenantProfileId,
        serverId: command.serverId,
        releaseId: command.releaseId,
        status: "RESERVED" as const,
        capacity: command.requestedCapacity,
      },
    };

    expect(evaluateProvisioningValidation(operation, snapshot)).toBeNull();
    expect(
      evaluateProvisioningValidation(operation, {
        ...snapshot,
        release: { status: "RETIRED" },
      }),
    ).toBe("RELEASE_NOT_VALIDATED");
    expect(
      evaluateProvisioningValidation(operation, {
        ...snapshot,
        reservation: { ...snapshot.reservation, status: "RELEASED" },
      }),
    ).toBe("RESERVATION_INVALID");
  });
});
