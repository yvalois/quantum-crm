import { describe, expect, it } from "vitest";

import { CrmPermissionCatalog, CreateRoleSchema, RoleSchema } from "./member.js";

describe("role contracts", () => {
  it("accepts custom role payloads and rejects unknown permissions", () => {
    expect(
      CreateRoleSchema.safeParse({
        displayName: "Ventas junior",
        permissions: ["crm:contacts:read"],
      }).success,
    ).toBe(true);
    expect(
      CreateRoleSchema.safeParse({ displayName: "Inválido", permissions: ["iam:unknown"] }).success,
    ).toBe(false);
  });

  it("requires the generated custom code shape in responses", () => {
    const parsed = RoleSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      code: "CUSTOM_VENTAS",
      displayName: "Ventas",
      system: false,
      authorizationRevision: "1",
      permissions: [],
      createdAt: "2026-09-27T12:00:00.000Z",
      updatedAt: "2026-09-27T12:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("keeps the five actions explicit for each active section", () => {
    for (const section of ["contacts", "sales", "tasks"] as const) {
      for (const action of ["read", "create", "update", "delete", "export"] as const) {
        expect(CrmPermissionCatalog).toContain(`crm:${section}:${action}`);
      }
    }
    for (const action of ["read", "upload", "reference", "download", "delete"] as const) {
      expect(CrmPermissionCatalog).toContain(`crm:files:${action}`);
    }
  });
});
