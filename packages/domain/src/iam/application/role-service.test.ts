import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError } from "./member-service.js";
import { IamRoleService } from "./role-service.js";
import type { IamRoleRepository } from "./role-repository.js";

const now = new Date("2026-09-27T12:00:00.000Z");
const actor = {
  memberId: "00000000-0000-4000-8000-000000000001",
  permissions: ["iam:members:roles"] as const,
};

function repository(): IamRoleRepository {
  return {
    list: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    create: vi.fn(async (role) => role),
    update: vi.fn(async (role) => role),
  };
}

describe("IamRoleService", () => {
  it("creates a profile-local role with catalog permissions", async () => {
    const repo = repository();
    const role = await new IamRoleService(repo, () => now).create({
      actor,
      displayName: "Ventas junior",
      permissions: ["crm:contacts:read", "crm:contacts:read"],
    });
    expect(role.code).toMatch(/^CUSTOM_[A-Z0-9]+$/u);
    expect(role.permissions).toEqual(["crm:contacts:read"]);
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it("rejects an actor without the role-management permission", async () => {
    await expect(
      new IamRoleService(repository(), () => now).list({
        memberId: actor.memberId,
        permissions: ["iam:members:read"],
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });
});
