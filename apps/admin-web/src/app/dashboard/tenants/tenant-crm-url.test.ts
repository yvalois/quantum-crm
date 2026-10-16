import { describe, expect, it } from "vitest";

import { tenantCrmUrl } from "./tenant-crm-url.js";

describe("tenant CRM link", () => {
  it("uses the full apex domain for a profile subdomain", () => {
    expect(tenantCrmUrl("https://quantumbusinessassistant.com", "interamerican")).toBe(
      "https://interamerican.quantumbusinessassistant.com",
    );
  });

  it("removes only the admin label on the legacy host", () => {
    expect(tenantCrmUrl("https://admin.2-25-172-119.nip.io", "interamerican")).toBe(
      "https://interamerican.2-25-172-119.nip.io",
    );
  });

  it("does not allow a slug to change the destination domain", () => {
    expect(() => tenantCrmUrl("https://quantumbusinessassistant.com", "../other")).toThrow(
      "Invalid tenant slug",
    );
  });
});
