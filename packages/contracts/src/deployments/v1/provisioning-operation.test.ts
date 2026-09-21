import { describe, expect, it } from "vitest";

import {
  ProvisioningOperationSchema,
  RequestTenantProvisioningSchema,
} from "./provisioning-operation.js";

describe("tenant provisioning operation HTTP contract", () => {
  it("accepts identifiers and a positive capacity request", () => {
    expect(
      RequestTenantProvisioningSchema.parse({
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
      }),
    ).toBeDefined();
    expect(
      RequestTenantProvisioningSchema.safeParse({
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
        shell: "docker compose up",
      }).success,
    ).toBe(false);
  });

  it("represents observed operation progress without exposing its lease", () => {
    expect(
      ProvisioningOperationSchema.parse({
        id: "01995f7e-7b52-7000-8000-000000000401",
        tenantProfileId: "01995f7e-7b52-7000-8000-000000000201",
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        requestedCapacity: { cpuMillicores: 500, memoryMiB: 1024, storageMiB: 10240 },
        capacityReservation: { id: "01995f7e-7b52-7000-8000-000000000501" },
        status: "RUNNING",
        currentStep: "CREATE_DATABASE",
        attempt: 1,
        version: "2",
        createdAt: "2026-09-20T12:00:00.000Z",
        updatedAt: "2026-09-20T12:00:01.000Z",
      }),
    ).toBeDefined();
  });
});
