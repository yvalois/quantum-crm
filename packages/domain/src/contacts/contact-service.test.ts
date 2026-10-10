import { describe, expect, it, vi } from "vitest";

import { IamAuthorizationError } from "../iam/index.js";
import { ContactService, type ContactRepository } from "./index.js";

const actor = { memberId: "019b0000-0000-7000-8000-000000000001", scope: "OWN" as const };
const emptyPage = Object.freeze({
  records: Object.freeze([]),
  total: 0,
  hasMoreInRequestedDirection: false,
});
const emptyBulk = Object.freeze({
  results: Object.freeze([]),
  updated: 0,
  unchanged: 0,
  notVisible: 0,
});

describe("contact service", () => {
  it("denies creation by default and forwards the canonical idempotency identity to its owner repository", async () => {
    const create = vi.fn(async (input) => input.contact);
    const repository: ContactRepository = {
      list: async () => [],
      listPage: async () => emptyPage,
      find: async () => null,
      listLabels: async () => [],
      createLabel: async () => ({ id: "019b0000-0000-7000-8000-000000000099", name: "VIP" }),
      canAssignOwner: async () => true,
      create,
      update: async () => null,
      bulk: async () => emptyBulk,
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
          labels: [],
          source: "MANUAL",
          archivedAt: null,
          version: 1n,
          createdAt: new Date("2026-09-26T12:00:00.000Z"),
          updatedAt: new Date("2026-09-26T12:00:00.000Z"),
        },
      ],
      listPage: async () => emptyPage,
      find: async () => null,
      listLabels: async () => [],
      createLabel: async () => ({ id: "019b0000-0000-7000-8000-000000000099", name: "VIP" }),
      canAssignOwner: async () => true,
      create: async (input) => input.contact,
      update: async () => null,
      bulk: async () => emptyBulk,
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

  it("forwards the complete server-side filter set to the contacts owner", async () => {
    const list = vi.fn(async () => []);
    const repository: ContactRepository = {
      list,
      listPage: async () => emptyPage,
      find: async () => null,
      listLabels: async () => [],
      createLabel: async () => ({ id: "019b0000-0000-7000-8000-000000000099", name: "VIP" }),
      canAssignOwner: async () => true,
      create: async (input) => input.contact,
      update: async () => null,
      bulk: async () => emptyBulk,
      importRows: async () => ({ rows: [], created: 0, updated: 0, errors: 0 }),
    };
    const service = new ContactService(repository);
    const filters = {
      label: "VIP",
      pipelineId: "019b0000-0000-7000-8000-000000000010",
      ownerMemberId: "019b0000-0000-7000-8000-000000000011",
      channel: "EMAIL" as const,
      createdFrom: new Date("2026-09-01T00:00:00.000Z"),
      createdTo: new Date("2026-09-30T23:59:59.999Z"),
    };
    await service.list(actor, ["crm:contacts:read"], filters);
    expect(list).toHaveBeenCalledWith(actor, filters);
  });

  it("keeps reassignment behind its explicit permission and validates the target server-side", async () => {
    const canAssignOwner = vi.fn(async () => false);
    const bulk = vi.fn(async () => emptyBulk);
    const repository: ContactRepository = {
      list: async () => [],
      listPage: async () => emptyPage,
      find: async () => null,
      listLabels: async () => [],
      createLabel: async () => ({ id: "019b0000-0000-7000-8000-000000000099", name: "VIP" }),
      canAssignOwner,
      create: async (input) => input.contact,
      update: async () => null,
      bulk,
      importRows: async () => ({ rows: [], created: 0, updated: 0, errors: 0 }),
    };
    const service = new ContactService(repository);
    const action = {
      action: "ASSIGN" as const,
      contactIds: ["019b0000-0000-7000-8000-000000000010"],
      ownerMemberId: "019b0000-0000-7000-8000-000000000011",
    };
    await expect(
      service.bulk({
        actor,
        permissions: ["crm:contacts:read"],
        action,
        idempotencyKey: "contact-bulk-0001",
        payloadHash: "a".repeat(64),
      }),
    ).rejects.toThrow(IamAuthorizationError);
    expect(canAssignOwner).not.toHaveBeenCalled();

    await expect(
      service.bulk({
        actor,
        permissions: ["crm:contacts:read", "crm:contacts:assign"],
        action,
        idempotencyKey: "contact-bulk-0002",
        payloadHash: "b".repeat(64),
      }),
    ).rejects.toThrow("Invalid contact");
    expect(canAssignOwner).toHaveBeenCalledWith(actor, action.ownerMemberId);
    expect(bulk).not.toHaveBeenCalled();
  });
});
