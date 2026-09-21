import { describe, expect, it } from "vitest";

import {
  CreateInfrastructureServerSchema,
  InfrastructureServerResponseSchema,
} from "./infrastructure-server.js";

const input = {
  code: "staging-primary",
  displayName: "Staging primary",
  provider: "Hostinger",
  region: "Bogota",
  publicIpv4: "192.0.2.10",
  operatingSystem: "Ubuntu 24.04 LTS",
  architecture: "X86_64",
  status: "AVAILABLE",
  totalCapacity: { cpuMillicores: 4000, memoryMiB: 8192, storageMiB: 102400 },
  operationCredentialRef: "secret://staging/servers/primary/ssh-key",
  confirmedAt: "2026-09-20T12:00:00.000Z",
};

describe("infrastructure server contract", () => {
  it("accepts bounded confirmed inventory", () => {
    expect(CreateInfrastructureServerSchema.parse(input)).toMatchObject({
      code: "staging-primary",
    });
  });

  it("rejects client-controlled reservations and literal credentials", () => {
    expect(
      CreateInfrastructureServerSchema.safeParse({
        ...input,
        reservedCapacity: { cpuMillicores: 1, memoryMiB: 1, storageMiB: 1 },
      }).success,
    ).toBe(false);
    expect(
      CreateInfrastructureServerSchema.safeParse({
        ...input,
        operationCredentialRef: "password=not-allowed",
      }).success,
    ).toBe(false);
  });

  it("exposes only whether credentials are configured", () => {
    const { operationCredentialRef, ...publicInput } = input;
    expect(operationCredentialRef).toContain("secret://");
    const response = InfrastructureServerResponseSchema.parse({
      schemaVersion: "infrastructure-server/v1",
      data: {
        ...publicInput,
        reservedCapacity: { cpuMillicores: 1000, memoryMiB: 2048, storageMiB: 20480 },
        id: "01995f7e-7b52-7000-8000-000000000301",
        availableCapacity: { cpuMillicores: 3000, memoryMiB: 6144, storageMiB: 81920 },
        credentialConfigured: true,
        version: "1",
        createdAt: input.confirmedAt,
        updatedAt: input.confirmedAt,
      },
    });
    expect(JSON.stringify(response)).not.toContain("secret://");
    expect(response.data.credentialConfigured).toBe(true);
  });
});
