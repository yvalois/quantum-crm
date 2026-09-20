import { describe, expect, it } from "vitest";

import { GET as adminLive } from "../../apps/admin-web/src/app/api/health/live/route.js";
import { GET as crmLive } from "../../apps/crm-web/src/app/api/health/live/route.js";
import { GET as portalLive } from "../../apps/portal-web/src/app/api/health/live/route.js";

describe("web health route handlers", () => {
  it.each([
    ["crm-web", crmLive],
    ["portal-web", portalLive],
    ["admin-web", adminLive],
  ])("returns the identity of %s", async (service, handler) => {
    const response = handler();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "health/v1",
      service,
      check: "live",
      status: "ok",
    });
  });
});
