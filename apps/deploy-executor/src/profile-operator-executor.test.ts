import { describe, expect, it, vi } from "vitest";

import type {
  ProfileOperatorAssignment,
  ProfileOperatorRepository,
} from "@quantum-crm/platform-domain";

import { ProfileOperatorExecutor } from "./profile-operator-executor.js";

const pending: ProfileOperatorAssignment = {
  id: "01999abc-7def-7000-8000-000000000001",
  tenantProfileId: "01999abc-7def-7000-8000-000000000002",
  requestedByOperatorId: "01999abc-7def-7000-8000-000000000003",
  operatorId: null,
  oidcSubject: null,
  displayName: "Gabriela Nufio",
  email: "admin@example.com",
  status: "PENDING",
  correlationId: "correlation-20261007",
  idempotencyKey: "operator-20261007",
  leaseOwner: "deploy-executor:test",
  leaseExpiresAt: new Date("2026-10-07T12:01:00.000Z"),
  version: 2n,
  createdAt: new Date("2026-10-07T12:00:00.000Z"),
  updatedAt: new Date("2026-10-07T12:00:00.000Z"),
};

describe("ProfileOperatorExecutor", () => {
  it("provisions the identity, activates the membership and delivers the password ephemerally", async () => {
    const complete = vi.fn(async () => ({
      ...pending,
      operatorId: "01999abc-7def-7000-8000-000000000004",
      oidcSubject: "01999abc-7def-7000-8000-000000000005",
      status: "ACTIVE" as const,
    }));
    const repository = {
      claimNext: vi.fn(async () => pending),
      complete,
      fail: vi.fn(),
    } as unknown as ProfileOperatorRepository;
    const provision = vi.fn(async () => ({
      subject: "01999abc-7def-7000-8000-000000000005",
      temporaryPassword: "Aa9!temporary-password",
    }));
    const deliver = vi.fn(async () => ({ accepted: true }));
    const executor = new ProfileOperatorExecutor(
      repository,
      { provision },
      { deliver },
      "deploy-executor:test",
    );

    await expect(executor.runOnce()).resolves.toBe(true);
    expect(provision).toHaveBeenCalledWith({
      assignmentId: pending.id,
      displayName: pending.displayName,
      email: pending.email,
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: pending.id,
        oidcSubject: "01999abc-7def-7000-8000-000000000005",
      }),
    );
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: pending.id,
        temporaryPassword: "Aa9!temporary-password",
      }),
    );
  });
});
