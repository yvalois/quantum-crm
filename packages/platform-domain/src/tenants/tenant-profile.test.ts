import { describe, expect, it } from "vitest";

import {
  createTenantProfileDraft,
  hydrateTenantProfile,
  TenantProfileValidationError,
  type TenantProfileStatus,
} from "./tenant-profile.js";

const validId = "01995f7e-7b52-7000-8000-000000000001";

describe("tenant profile", () => {
  it("normalizes a valid registration and defaults to pending", () => {
    const profile = createTenantProfileDraft({
      name: "  Acme Colombia  ",
      slug: "  ACME-CO  ",
      adminContactName: "  Ana Perez  ",
      adminContactEmail: "  ADMIN@ACME.EXAMPLE  ",
    });

    expect(profile).toEqual({
      name: "Acme Colombia",
      slug: "acme-co",
      adminContactName: "Ana Perez",
      adminContactEmail: "admin@acme.example",
      status: "PENDING",
    });
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it.each([
    ["name", { name: " " }],
    ["slug", { slug: "bad slug" }],
    ["slug", { slug: "-invalid" }],
    ["adminContactName", { adminContactName: " " }],
    ["adminContactEmail", { adminContactEmail: "invalid" }],
    ["status", { status: "INVALID" as TenantProfileStatus }],
    ["serverId", { serverId: "not-a-uuid" }],
    ["releaseId", { releaseId: "not-a-uuid" }],
  ])("rejects an invalid %s", (field, override) => {
    expect(() =>
      createTenantProfileDraft({
        name: "Acme",
        slug: "acme",
        adminContactName: "Ana",
        adminContactEmail: "ana@acme.example",
        ...override,
      }),
    ).toThrow(new TenantProfileValidationError(field));
  });

  it("hydrates immutable persisted state", () => {
    const createdAt = new Date("2026-09-20T00:00:00.000Z");
    const profile = hydrateTenantProfile({
      ...createTenantProfileDraft({
        name: "Acme",
        slug: "acme",
        adminContactName: "Ana",
        adminContactEmail: "ana@acme.example",
      }),
      id: validId,
      version: 1n,
      createdAt,
      updatedAt: createdAt,
    });

    createdAt.setUTCFullYear(2030);

    expect(profile.id).toBe(validId);
    expect(profile.createdAt.toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it("rejects invalid persisted identity, version and chronology", () => {
    const valid = {
      ...createTenantProfileDraft({
        name: "Acme",
        slug: "acme",
        adminContactName: "Ana",
        adminContactEmail: "ana@acme.example",
      }),
      id: validId,
      version: 1n,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    };

    expect(() => hydrateTenantProfile({ ...valid, id: "invalid" })).toThrow(
      new TenantProfileValidationError("id"),
    );
    expect(() => hydrateTenantProfile({ ...valid, version: 0n })).toThrow(
      new TenantProfileValidationError("version"),
    );
    expect(() =>
      hydrateTenantProfile({
        ...valid,
        updatedAt: new Date("2026-09-19T23:59:59.000Z"),
      }),
    ).toThrow(new TenantProfileValidationError("updatedAt"));
  });
});
