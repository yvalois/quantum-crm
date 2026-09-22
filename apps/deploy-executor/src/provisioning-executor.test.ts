import {
  hydrateProvisioningOperation,
  type ProvisioningOperationRepository,
} from "@quantum-crm/platform-domain";
import { describe, expect, it, vi } from "vitest";

import { ProvisioningExecutor } from "./provisioning-executor.js";

const operation = hydrateProvisioningOperation({
  id: "01995f7e-7b52-7000-8000-000000000401",
  tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
  serverId: "01995f7e-7b52-7000-8000-000000000301",
  releaseId: "01995f7e-7b52-7000-8000-000000000302",
  requestedByOperatorId: "01995f7e-7b52-7000-8000-000000000101",
  idempotencyKey: "provision-acme-001",
  correlationId: "request-001",
  requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
  status: "RUNNING",
  currentStep: "VALIDATE",
  attempt: 1,
  version: 2n,
  failureCode: null,
  lease: {
    owner: "deploy-executor:test",
    lastHeartbeatAt: new Date("2026-09-21T12:00:00.000Z"),
    expiresAt: new Date("2026-09-21T12:01:00.000Z"),
  },
  createdAt: new Date("2026-09-21T11:59:00.000Z"),
  updatedAt: new Date("2026-09-21T12:00:00.000Z"),
  capacityReservation: {
    id: "01995f7e-7b52-7000-8000-000000000501",
    capacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
  },
});

function repository(overrides: Partial<ProvisioningOperationRepository> = {}) {
  return {
    request: vi.fn(),
    claimNext: vi.fn(async () => null),
    renewLease: vi.fn(async () => null),
    completeValidation: vi.fn(async () => null),
    completeDatabase: vi.fn(async () => null),
    completeSecrets: vi.fn(async () => null),
    completeStorage: vi.fn(async () => null),
    completeConfiguration: vi.fn(async () => null),
    completeContainers: vi.fn(async () => null),
    completeHttps: vi.fn(async () => null),
    resolveHttpsContext: vi.fn(async () => null),
    ...overrides,
  } satisfies ProvisioningOperationRepository;
}

const options = {
  workerId: "deploy-executor:test",
  leaseDurationSeconds: 60,
  idlePollMilliseconds: 1_000,
} as const;

describe("provisioning executor", () => {
  it("claims only VALIDATE and completes it with the observed fence", async () => {
    const claimNext = vi.fn(async () => operation);
    const completeValidation = vi.fn(async () => null);
    const executor = new ProvisioningExecutor(
      repository({ claimNext, completeValidation }),
      options,
    );

    await expect(executor.runOnce()).resolves.toBe(true);
    expect(claimNext).toHaveBeenCalledWith({
      workerId: options.workerId,
      leaseDurationSeconds: 60,
      supportedSteps: ["VALIDATE"],
    });
    expect(completeValidation).toHaveBeenCalledWith({
      operationId: operation.id,
      workerId: options.workerId,
      expectedVersion: operation.version,
      attempt: operation.attempt,
    });
  });

  it("does not attempt completion when there is no supported work", async () => {
    const durableRepository = repository();
    const executor = new ProvisioningExecutor(durableRepository, options);

    await expect(executor.runOnce()).resolves.toBe(false);
    expect(durableRepository.completeValidation).not.toHaveBeenCalled();
  });

  it("stops an idle loop cooperatively", async () => {
    const wait = vi.fn(async (_milliseconds: number, signal: AbortSignal) => {
      if (signal.aborted) return;
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
    });
    const executor = new ProvisioningExecutor(repository(), options, wait);
    const execution = executor.start();
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());

    await executor.close();
    await expect(execution).resolves.toBeUndefined();
  });

  it("reconciles ready containers and advances with the observed fence", async () => {
    const startOperation = hydrateProvisioningOperation({
      ...operation,
      currentStep: "START_CONTAINERS",
    });
    const claimNext = vi.fn(async () => startOperation);
    const completeContainers = vi.fn(async () => null);
    const containerProvision = vi.fn(async () => ({
      projectName: `qcrm-t-${startOperation.tenantProfileId}`,
      services: ["agent-runtime", "api", "crm-web", "portal-web", "worker"] as const,
      ready: true,
      reconciled: false,
    }));
    const executor = new ProvisioningExecutor(
      repository({ claimNext, completeContainers }),
      options,
      undefined,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { provision: containerProvision },
    );

    await expect(executor.runOnce()).resolves.toBe(true);
    expect(claimNext).toHaveBeenCalledWith({
      workerId: options.workerId,
      leaseDurationSeconds: 60,
      supportedSteps: [
        "VALIDATE",
        "CREATE_DATABASE",
        "CREATE_SECRETS",
        "CREATE_STORAGE",
        "WRITE_CONFIGURATION",
        "START_CONTAINERS",
      ],
    });
    expect(completeContainers).toHaveBeenCalledWith({
      operationId: startOperation.id,
      tenantProfileId: startOperation.tenantProfileId,
      serverId: startOperation.serverId,
      releaseId: startOperation.releaseId,
      workerId: options.workerId,
      expectedVersion: startOperation.version,
      attempt: startOperation.attempt,
      manifestRef: `tenant/${startOperation.tenantProfileId}/configuration.json`,
      configurationRevision: 1n,
      projectName: `qcrm-t-${startOperation.tenantProfileId}`,
      services: ["agent-runtime", "api", "crm-web", "portal-web", "worker"],
      ready: true,
      reconciled: false,
    });
  });

  it("reconciles the derived HTTPS route and persists its observed generation", async () => {
    const httpsOperation = hydrateProvisioningOperation({
      ...operation,
      currentStep: "CONFIGURE_HTTPS",
    });
    const claimNext = vi.fn(async () => httpsOperation);
    const resolveHttpsContext = vi.fn(async () => ({
      hostname: "acme.2-25-172-119.nip.io",
      edgeNetworkName: `qcrm-tenant-edge-${httpsOperation.tenantProfileId}`,
      upstreamServices: ["crm-web"] as const,
      configurationRevision: 1n,
    }));
    const completeHttps = vi.fn(async () => null);
    const provision = vi.fn(async () => ({
      hostname: "acme.2-25-172-119.nip.io",
      edgeNetworkName: `qcrm-tenant-edge-${httpsOperation.tenantProfileId}`,
      routeGeneration: 1n,
      configured: true,
      reconciled: true,
    }));
    const executor = new ProvisioningExecutor(
      repository({ claimNext, resolveHttpsContext, completeHttps }),
      options,
      undefined,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { provision },
    );

    await expect(executor.runOnce()).resolves.toBe(true);
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "acme.2-25-172-119.nip.io",
        upstreamServices: ["crm-web"],
      }),
    );
    expect(completeHttps).toHaveBeenCalledWith(
      expect.objectContaining({ routeGeneration: 1n, configured: true, reconciled: true }),
    );
  });
});
