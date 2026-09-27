import { describe, expect, it } from "vitest";

import { UpdateContactSchema } from "./contact.js";

describe("contact update contract", () => {
  it("distinguishes an intentional channel clear from an omitted field", () => {
    expect(UpdateContactSchema.parse({ email: null, phone: null })).toEqual({
      email: null,
      phone: null,
    });
    expect(UpdateContactSchema.safeParse({}).success).toBe(false);
  });

  it("keeps update validation strict for malformed channels and unknown fields", () => {
    expect(UpdateContactSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(UpdateContactSchema.safeParse({ phone: "  " }).success).toBe(false);
    expect(UpdateContactSchema.safeParse({ email: null, ownerMemberId: "ignored" }).success).toBe(false);
  });
});
