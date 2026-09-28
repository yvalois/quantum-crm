import { describe, expect, it } from "vitest";

import { ContactListQuerySchema, UpdateContactSchema } from "./contact.js";

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
    expect(UpdateContactSchema.safeParse({ email: null, ownerMemberId: "ignored" }).success).toBe(
      false,
    );
  });

  it("validates combinable contact filters and rejects invalid ranges", () => {
    expect(
      ContactListQuerySchema.safeParse({
        label: "VIP",
        pipelineId: "019b0000-0000-7000-8000-000000000010",
        ownerMemberId: "019b0000-0000-7000-8000-000000000011",
        channel: "EMAIL",
        createdFrom: "2026-09-01",
        createdTo: "2026-09-30",
      }).success,
    ).toBe(true);
    expect(
      ContactListQuerySchema.safeParse({
        createdFrom: "2026-10-01",
        createdTo: "2026-09-30",
      }).success,
    ).toBe(false);
  });
});
