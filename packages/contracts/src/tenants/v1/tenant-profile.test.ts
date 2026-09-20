import { describe, expect, it } from "vitest";

import {
  CreateTenantProfileSchema,
  TenantProfileListQuerySchema,
  UpdateTenantProfileSchema,
} from "./tenant-profile.js";

describe("tenant profile HTTP contracts", () => {
  it("normalizes a valid creation command and rejects unknown fields", () => {
    expect(
      CreateTenantProfileSchema.parse({
        name: " Acme Colombia ",
        slug: " Acme-Colombia ",
        adminContactName: " Ana ",
        adminContactEmail: " ADMIN@ACME.TEST ",
      }),
    ).toEqual({
      name: "Acme Colombia",
      slug: "acme-colombia",
      adminContactName: "Ana",
      adminContactEmail: "admin@acme.test",
    });
    expect(
      CreateTenantProfileSchema.safeParse({
        name: "Acme",
        slug: "acme",
        adminContactName: "Ana",
        adminContactEmail: "admin@acme.test",
        tenantId: "not-accepted",
      }).success,
    ).toBe(false);
  });

  it("bounds collection input and requires a real update", () => {
    expect(TenantProfileListQuerySchema.parse({ pageSize: "100" }).pageSize).toBe(100);
    expect(TenantProfileListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(UpdateTenantProfileSchema.safeParse({}).success).toBe(false);
    expect(UpdateTenantProfileSchema.safeParse({ serverId: null }).success).toBe(true);
    expect(UpdateTenantProfileSchema.safeParse({ status: "ACTIVE" }).success).toBe(false);
  });
});
