import { describe, expect, it } from "vitest";

import {
  ContactBulkActionSchema,
  ContactListQuerySchema,
  CreateContactSchema,
  UpdateContactSchema,
} from "./contact.js";

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
    const filters = ContactListQuerySchema.parse({
      q: " Ada ",
      limit: "25",
      sort: "NAME_ASC",
      label: "VIP",
      pipelineId: "019b0000-0000-7000-8000-000000000010",
      ownerMemberId: "019b0000-0000-7000-8000-000000000011",
      channel: "EMAIL",
      source: "IMPORT",
      archived: "true",
      assignment: "UNASSIGNED",
      createdFrom: "2026-09-01",
      createdTo: "2026-09-30",
    });
    expect(filters).toMatchObject({
      q: "Ada",
      limit: 25,
      sort: "NAME_ASC",
      archived: true,
      assignment: "UNASSIGNED",
    });
    expect(
      ContactListQuerySchema.safeParse({
        createdFrom: "2026-10-01",
        createdTo: "2026-09-30",
      }).success,
    ).toBe(false);
  });

  it("accepts a one-step operational contact draft and deduplicates bulk selections", () => {
    expect(
      CreateContactSchema.parse({
        displayName: "Ada Lovelace",
        email: "ADA@example.test",
        ownerMemberId: "019b0000-0000-7000-8000-000000000011",
        source: "MIGRATION",
        labelIds: ["019b0000-0000-7000-8000-000000000012"],
      }),
    ).toMatchObject({ email: "ada@example.test", source: "MIGRATION" });
    expect(
      ContactBulkActionSchema.parse({
        action: "ARCHIVE",
        contactIds: [
          "019b0000-0000-7000-8000-000000000010",
          "019b0000-0000-7000-8000-000000000010",
        ],
      }).contactIds,
    ).toEqual(["019b0000-0000-7000-8000-000000000010"]);
  });
});
