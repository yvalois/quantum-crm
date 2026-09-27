import { describe, expect, it } from "vitest";

import { ServicePermissionCatalog, ServicePermissionSchema } from "./service-permission.js";

describe("service permission contracts", () => {
  it("admits only the bootstrap permission issued to the tenant service principal", () => {
    expect(ServicePermissionCatalog).toContain("iam:bootstrap-initial-administrator");
    expect(ServicePermissionSchema.safeParse("iam:bootstrap-initial-administrator").success).toBe(
      true,
    );
    expect(ServicePermissionSchema.safeParse("iam:members:create").success).toBe(false);
  });
});
