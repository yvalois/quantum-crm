import { describe, expect, it } from "vitest";

import { RequestTenantProvisioningSchema } from "./provisioning-operation.js";

describe("tenant provisioning operation HTTP contract", () => {
  it("accepts only server and release identifiers", () => {
    expect(
      RequestTenantProvisioningSchema.parse({
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
      }),
    ).toBeDefined();
    expect(
      RequestTenantProvisioningSchema.safeParse({
        serverId: "01995f7e-7b52-7000-8000-000000000301",
        releaseId: "01995f7e-7b52-7000-8000-000000000302",
        shell: "docker compose up",
      }).success,
    ).toBe(false);
  });
});
