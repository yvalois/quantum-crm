import { describe, expect, it } from "vitest";

import {
  createPlatformOperatorMembershipDraft,
  hydratePlatformOperatorMembership,
  PlatformOperatorMembershipValidationError,
  type PlatformOperatorStatus,
  type PlatformPermission,
} from "./operator-membership.js";

const validId = "01995f7e-7b52-7000-8000-000000000101";

describe("platform operator membership", () => {
  it("normalizes a pending membership and a closed permission set", () => {
    const membership = createPlatformOperatorMembershipDraft({
      oidcSubject: "  9ac76218-operator-subject  ",
      permissions: ["tenants:read", "deployments:execute", "tenants:read"],
    });

    expect(membership).toEqual({
      oidcSubject: "9ac76218-operator-subject",
      status: "PENDING",
      permissions: ["deployments:execute", "tenants:read"],
    });
    expect(Object.isFrozen(membership)).toBe(true);
    expect(Object.isFrozen(membership.permissions)).toBe(true);
  });

  it.each([
    ["oidcSubject", { oidcSubject: " " }],
    ["oidcSubject", { oidcSubject: "subject with spaces" }],
    ["status", { status: "INVALID" as PlatformOperatorStatus }],
    ["permissions", { permissions: ["root:anything" as PlatformPermission] }],
  ])("rejects an invalid %s", (field, override) => {
    expect(() =>
      createPlatformOperatorMembershipDraft({
        oidcSubject: "valid-subject",
        ...override,
      }),
    ).toThrow(new PlatformOperatorMembershipValidationError(field));
  });

  it("hydrates immutable persisted state", () => {
    const createdAt = new Date("2026-09-20T00:00:00.000Z");
    const membership = hydratePlatformOperatorMembership({
      ...createPlatformOperatorMembershipDraft({
        oidcSubject: "operator-subject",
        status: "ACTIVE",
        permissions: ["operators:manage"],
      }),
      id: validId,
      authorizationRevision: 3n,
      createdAt,
      updatedAt: createdAt,
    });

    createdAt.setUTCFullYear(2030);

    expect(membership).toMatchObject({
      id: validId,
      authorizationRevision: 3n,
      status: "ACTIVE",
    });
    expect(membership.createdAt.toISOString()).toBe("2026-09-20T00:00:00.000Z");
  });

  it("rejects invalid identity, revision and chronology from persistence", () => {
    const valid = {
      ...createPlatformOperatorMembershipDraft({ oidcSubject: "operator-subject" }),
      id: validId,
      authorizationRevision: 1n,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    };

    expect(() => hydratePlatformOperatorMembership({ ...valid, id: "invalid" })).toThrow(
      new PlatformOperatorMembershipValidationError("id"),
    );
    expect(() =>
      hydratePlatformOperatorMembership({ ...valid, authorizationRevision: 0n }),
    ).toThrow(new PlatformOperatorMembershipValidationError("authorizationRevision"));
    expect(() =>
      hydratePlatformOperatorMembership({
        ...valid,
        updatedAt: new Date("2026-09-19T23:59:59.000Z"),
      }),
    ).toThrow(new PlatformOperatorMembershipValidationError("updatedAt"));
  });
});
