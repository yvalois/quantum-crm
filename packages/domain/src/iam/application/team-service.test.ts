import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError } from "./member-service.js";
import {
  IamTeamConflictError,
  IamTeamMemberNotFoundError,
  IamTeamService,
} from "./team-service.js";
import type { IamTeamRepository } from "./team-repository.js";

const actor = {
  memberId: "01995f7e-7b52-7000-8000-000000000001",
  permissions: ["iam:teams:read", "iam:teams:create", "iam:teams:update"] as const,
};

function repository(): IamTeamRepository {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async (team) => team),
    addMember: vi.fn(async () => null),
    removeMember: vi.fn(async () => null),
  };
}

describe("IamTeamService", () => {
  it("creates a normalized team with the dedicated permission", async () => {
    const repo = repository();
    const service = new IamTeamService(repo, () => new Date("2026-09-27T12:00:00.000Z"));

    const result = await service.create({ actor, name: "  Ventas  " });

    expect(result.name).toBe("Ventas");
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it("denies team management without the matching permission", async () => {
    const service = new IamTeamService(repository());

    await expect(service.list({ ...actor, permissions: [] })).rejects.toBeInstanceOf(
      IamAuthorizationError,
    );
  });

  it("turns duplicate names into a typed conflict", async () => {
    const repo = repository();
    vi.mocked(repo.create).mockResolvedValue(null);
    const service = new IamTeamService(repo);

    await expect(service.create({ actor, name: "Ventas" })).rejects.toBeInstanceOf(
      IamTeamConflictError,
    );
  });

  it("rejects missing or inactive members without changing the team", async () => {
    const service = new IamTeamService(repository());

    await expect(
      service.addMember({
        actor,
        teamId: "01995f7e-7b52-7000-8000-000000000010",
        memberId: "01995f7e-7b52-7000-8000-000000000011",
      }),
    ).rejects.toBeInstanceOf(IamTeamMemberNotFoundError);
  });
});
