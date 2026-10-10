import { describe, expect, it } from "vitest";

import {
  ContactBulkActionSchema,
  ContactBulkFilterSchema,
  ContactListQuerySchema,
  CreateContactSchema,
  UpdateContactSchema,
} from "./contact.js";

describe("contact update contract", () => {
  it("distinguishes an intentional channel clear from an omitted field", () => {
    const ownerMemberId = "019b0000-0000-7000-8000-000000000011";
    expect(
      UpdateContactSchema.parse({
        email: null,
        phone: null,
        ownerMemberId: null,
        labelIds: [],
      }),
    ).toEqual({ email: null, phone: null, ownerMemberId: null, labelIds: [] });
    expect(UpdateContactSchema.parse({ ownerMemberId })).toEqual({ ownerMemberId });
    expect(UpdateContactSchema.safeParse({}).success).toBe(false);
  });

  it("keeps update validation strict for malformed channels and unknown fields", () => {
    expect(UpdateContactSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(UpdateContactSchema.safeParse({ phone: "  " }).success).toBe(false);
    expect(UpdateContactSchema.safeParse({ email: null, ownerMemberId: "ignored" }).success).toBe(
      false,
    );
    expect(UpdateContactSchema.safeParse({ labelIds: ["not-a-label"] }).success).toBe(false);
    expect(
      UpdateContactSchema.safeParse({
        labelIds: Array.from({ length: 41 }, () => "019b0000-0000-7000-8000-000000000011"),
      }).success,
    ).toBe(false);
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

  it("accepts a one-step operational contact draft and deduplicates direct bulk selections", () => {
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

  it("accepts a server-side bulk filter snapshot without pagination or ordering", () => {
    const action = ContactBulkActionSchema.parse({
      action: "ARCHIVE",
      filter: {
        q: " Ada ",
        label: "VIP",
        archived: "false",
        createdFrom: "2026-09-01T00:00:00.000Z",
        createdTo: "2026-09-30T23:59:59.999Z",
      },
    });
    expect(action).toMatchObject({
      action: "ARCHIVE",
      filter: {
        q: "Ada",
        label: "VIP",
        archived: false,
      },
    });
    expect(action.contactIds).toBeUndefined();

    expect(
      ContactBulkFilterSchema.safeParse({
        limit: 100,
      }).success,
    ).toBe(false);
    expect(
      ContactBulkFilterSchema.safeParse({
        createdFrom: "2026-10-01T00:00:00.000Z",
        createdTo: "2026-09-30T23:59:59.999Z",
      }).success,
    ).toBe(false);
  });

  it("requires exactly one direct selection or server-side filter for a bulk action", () => {
    const contactId = "019b0000-0000-7000-8000-000000000010";
    expect(ContactBulkActionSchema.safeParse({ action: "ARCHIVE" }).success).toBe(false);
    expect(
      ContactBulkActionSchema.safeParse({
        action: "ARCHIVE",
        contactIds: [contactId],
        filter: { archived: false },
      }).success,
    ).toBe(false);
  });
});
