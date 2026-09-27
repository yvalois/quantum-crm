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
});
