import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError } from "../iam/index.js";
import { ContactService, type ContactRepository } from "./index.js";

const actor = { memberId: "019b0000-0000-7000-8000-000000000001", scope: "OWN" as const };

describe("contact service", () => {
  it("denies creation by default and forwards the canonical idempotency identity to its owner repository", async () => {
    const create = vi.fn(async (input) => input.contact);
    const repository: ContactRepository = {
      list: async () => [],
      find: async () => null,
      create,
      update: async () => null,
      importRows: async (input) => ({
        rows: [],
        created: input.rows.length,
        updated: 0,
        errors: 0,
      }),
    };
    const service = new ContactService(repository, () => new Date("2026-09-26T12:00:00.000Z"));
    expect(() =>
      service.create({
        actor,
        permissions: [],
        displayName: "Ada",
        idempotencyKey: "contact-create-0001",
        payloadHash: "a".repeat(64),
      }),
    ).toThrow(IamAuthorizationError);
    await service.create({
      actor,
      permissions: ["crm:contacts:create"],
      displayName: "Ada",
      idempotencyKey: "contact-create-0001",
      payloadHash: "a".repeat(64),
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actor,
        idempotencyKey: "contact-create-0001",
        payloadHash: "a".repeat(64),
      }),
    );
  });

  it("previews valid rows and detects visible matches without mutating", async () => {
    const repository: ContactRepository = {
      list: async () => [
        {
          id: "019b0000-0000-7000-8000-000000000002",
          ownerMemberId: actor.memberId,
          displayName: "Ada",
          email: "ada@example.test",
          phone: null,
          version: 1n,
          createdAt: new Date("2026-09-26T12:00:00.000Z"),
          updatedAt: new Date("2026-09-26T12:00:00.000Z"),
        },
      ],
      find: async () => null,
      create: async (input) => input.contact,
      update: async () => null,
      importRows: async () => ({ rows: [], created: 0, updated: 0, errors: 0 }),
    };
    const service = new ContactService(repository);
    await expect(
      service.previewImport(
        actor,
        ["crm:contacts:read"],
        [
          { rowNumber: 2, displayName: "Ada", email: "ADA@example.test", phone: null },
          { rowNumber: 3, displayName: "", email: null, phone: null },
        ],
      ),
    ).resolves.toMatchObject([
      { status: "MATCH", contactId: "019b0000-0000-7000-8000-000000000002" },
      { status: "ERROR", contactId: null },
    ]);
  });
});
