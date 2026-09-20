import { describe, expect, it } from "vitest";

import {
  createInfrastructureServerDraft,
  hydrateInfrastructureServer,
  InfrastructureServerValidationError,
} from "./infrastructure-server.js";

const valid = {
  code: "staging-primary",
  displayName: "Staging primary",
  provider: "Hostinger",
  region: "Bogota",
  publicIpv4: "192.0.2.10",
  operatingSystem: "Ubuntu 24.04 LTS",
  architecture: "X86_64" as const,
  status: "AVAILABLE" as const,
  totalCapacity: { cpuMillicores: 4000, memoryMiB: 8192, storageMiB: 102400 },
  reservedCapacity: { cpuMillicores: 1000, memoryMiB: 2048, storageMiB: 20480 },
  operationCredentialRef: "secret://staging/servers/primary/ssh-key",
  confirmedAt: new Date("2026-09-20T12:00:00.000Z"),
};

describe("infrastructure server", () => {
  it("normalizes confirmed inventory and derives available capacity", () => {
    const draft = createInfrastructureServerDraft({
      ...valid,
      code: " STAGING-PRIMARY ",
      publicIpv4: " 192.0.2.10 ",
    });
    const server = hydrateInfrastructureServer({
      ...draft,
      id: "01995f7e-7b52-7000-8000-000000000301",
      version: 1n,
      createdAt: valid.confirmedAt,
      updatedAt: valid.confirmedAt,
    });
    expect(server.code).toBe("staging-primary");
    expect(server.availableCapacity).toEqual({
      cpuMillicores: 3000,
      memoryMiB: 6144,
      storageMiB: 81920,
    });
    expect(Object.isFrozen(server.availableCapacity)).toBe(true);
  });

  it.each([
    ["publicIpv4", { publicIpv4: "999.1.1.1" }],
    ["operationCredentialRef", { operationCredentialRef: "ssh-password=secret" }],
    [
      "reservedCapacity",
      { reservedCapacity: { cpuMillicores: 5000, memoryMiB: 0, storageMiB: 0 } },
    ],
    [
      "totalCapacity.cpuMillicores",
      { totalCapacity: { cpuMillicores: 0, memoryMiB: 1, storageMiB: 1 } },
    ],
  ])("rejects invalid %s", (field, override) => {
    expect(() => createInfrastructureServerDraft({ ...valid, ...override })).toThrow(
      new InfrastructureServerValidationError(field),
    );
  });
});
