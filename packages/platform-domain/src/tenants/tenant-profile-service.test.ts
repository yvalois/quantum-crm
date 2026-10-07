import { describe, expect, it, vi } from "vitest";

import { hydrateTenantProfile, type TenantProfile } from "./tenant-profile.js";
import {
  TenantProfileNotFoundError,
  TenantProfileService,
  TenantProfileVersionConflictError,
  type TenantProfileRepository,
} from "./tenant-profile-service.js";

function profile(overrides: Partial<TenantProfile> = {}): TenantProfile {
  return hydrateTenantProfile({
    id: "01995f7e-7b52-7000-8000-000000000201",
    name: "Acme",
    slug: "acme",
    adminContactName: "Ana",
    adminContactEmail: "admin@acme.test",
    status: "PENDING",
    version: 1n,
    createdAt: new Date("2026-09-20T12:00:00.000Z"),
    updatedAt: new Date("2026-09-20T12:00:00.000Z"),
    ...overrides,
  });
}

function repository(current: TenantProfile | null = profile()): TenantProfileRepository {
  return {
    create: vi.fn(async () => profile()),
    findById: vi.fn(async () => current),
    list: vi.fn(async () => ({ items: current ? [current] : [], nextCursor: null })),
    update: vi.fn(async (_id, version, draft) =>
      version === 1n ? profile({ ...draft, version: 2n }) : null,
    ),
    removePending: vi.fn(async (_id, version) => version === 1n),
  };
}

describe("TenantProfileService", () => {
  it("normalizes creation through the domain before persisting", async () => {
    const adapter = repository();
    const service = new TenantProfileService(adapter);
    await service.create({
      name: " Acme ",
      slug: " ACME ",
      adminContactName: " Ana ",
      adminContactEmail: " ADMIN@ACME.TEST ",
    });
    expect(adapter.create).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "acme", adminContactEmail: "admin@acme.test" }),
    );
  });

  it("preserves operational assignments while updating profile metadata", async () => {
    const adapter = repository(
      profile({
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
      }),
    );
    const service = new TenantProfileService(adapter);
    const updated = await service.update("01995f7e-7b52-7000-8000-000000000201", 1n, {
      name: "Acme Uno",
    });
    expect(updated.version).toBe(2n);
    expect(adapter.update).toHaveBeenCalledWith(
      expect.any(String),
      1n,
      expect.objectContaining({ name: "Acme Uno", releaseId: expect.any(String) }),
    );
    expect((adapter.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toHaveProperty(
      "serverId",
    );
  });

  it("distinguishes missing profiles from stale versions", async () => {
    await expect(new TenantProfileService(repository(null)).get("missing")).rejects.toBeInstanceOf(
      TenantProfileNotFoundError,
    );
    await expect(
      new TenantProfileService(repository()).update("01995f7e-7b52-7000-8000-000000000201", 2n, {
        name: "Late",
      }),
    ).rejects.toBeInstanceOf(TenantProfileVersionConflictError);
  });

  it("removes only a confirmed pending draft", async () => {
    const adapter = repository();
    await new TenantProfileService(adapter).removePending(
      "01995f7e-7b52-7000-8000-000000000201",
      1n,
      "acme",
    );
    expect(adapter.removePending).toHaveBeenCalledWith("01995f7e-7b52-7000-8000-000000000201", 1n);
  });
});
