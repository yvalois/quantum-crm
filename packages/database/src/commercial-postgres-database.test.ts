import type { CommercialActor, ContactRecord, TaskRecord } from "@quantum-crm/domain";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  CommercialIdempotencyConflictError,
  createCommercialPostgresRepositories,
} from "./commercial-postgres-database.js";
import type { PostgresPool } from "./postgres-database.js";

const actor: CommercialActor = Object.freeze({
  memberId: "019b0000-0000-7000-8000-000000000005",
  scope: "OWN",
});
const now = new Date("2026-09-30T15:00:00.000Z");
const taskRow = Object.freeze({
  id: "019b0000-0000-7000-8000-000000000004",
  created_by_member_id: actor.memberId,
  contact_id: "019b0000-0000-7000-8000-000000000006",
  opportunity_id: null,
  assignee_member_id: actor.memberId,
  title: "Call",
  description: "Confirm scope",
  priority: "medium",
  type: "call",
  origin: "manual",
  due_at: new Date("2026-09-29T15:00:00.000Z"),
  status: "pending",
  completed_at: null,
  completed_by_member_id: null,
  version: "1",
  created_at: new Date("2026-09-28T15:00:00.000Z"),
  updated_at: new Date("2026-09-28T15:00:00.000Z"),
});
const taskRecord: TaskRecord = Object.freeze({
  id: taskRow.id,
  createdByMemberId: taskRow.created_by_member_id,
  contactId: taskRow.contact_id,
  opportunityId: null,
  assigneeMemberId: taskRow.assignee_member_id,
  title: taskRow.title,
  description: taskRow.description,
  priority: "MEDIUM",
  type: "CALL",
  origin: "MANUAL",
  dueAt: taskRow.due_at,
  status: "PENDING",
  completedAt: null,
  completedByMemberId: null,
  version: 1n,
  createdAt: taskRow.created_at,
  updatedAt: taskRow.updated_at,
});
const contactRow = Object.freeze({
  id: "019b0000-0000-7000-8000-000000000020",
  owner_member_id: actor.memberId,
  display_name: "Ada Lovelace",
  email: "ada@example.test",
  phone: null,
  source: "manual",
  archived_at: null,
  labels: [{ id: "019b0000-0000-7000-8000-000000000021", name: "Existing" }],
  version: "1",
  created_at: new Date("2026-09-28T15:00:00.000Z"),
  updated_at: new Date("2026-09-28T15:00:00.000Z"),
});
const contactRecord: ContactRecord = Object.freeze({
  id: contactRow.id,
  ownerMemberId: contactRow.owner_member_id,
  displayName: contactRow.display_name,
  email: contactRow.email,
  phone: contactRow.phone,
  labels: Object.freeze(
    contactRow.labels.map((label) => Object.freeze({ id: label.id, name: label.name })),
  ),
  source: "MANUAL",
  archivedAt: null,
  version: 1n,
  createdAt: contactRow.created_at,
  updatedAt: contactRow.updated_at,
});

function poolWithClientQuery(query: ReturnType<typeof vi.fn>) {
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return {
    pool: {
      connect: vi.fn(async () => client),
      query: vi.fn(),
      end: vi.fn(async () => undefined),
      on: vi.fn(),
    } as unknown as PostgresPool,
    client,
  };
}

describe("commercial PostgreSQL repositories", () => {
  it("updates contact data and replaces labels inside one versioned transaction", async () => {
    const ownerMemberId = "019b0000-0000-7000-8000-000000000022";
    const labelId = "019b0000-0000-7000-8000-000000000023";
    const hydratedRow = Object.freeze({
      ...contactRow,
      owner_member_id: ownerMemberId,
      display_name: "Ada Byron",
      labels: [{ id: labelId, name: "VIP" }],
      version: "2",
      updated_at: now,
    });
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes("UPDATE contacts.contacts AS contact"))
        return { rows: [{ id: contactRow.id }] };
      if (text.includes("FROM contacts.labels") && text.includes("FOR KEY SHARE"))
        return { rows: [{ id: labelId }] };
      if (text.includes("FROM contacts.contacts AS contact") && text.includes("FOR UPDATE"))
        return { rows: [hydratedRow] };
      return { rows: [] };
    });
    const { pool, client } = poolWithClientQuery(query);

    await expect(
      createCommercialPostgresRepositories(pool).contacts.update({
        actor,
        contact: Object.freeze({
          ...contactRecord,
          ownerMemberId,
          displayName: hydratedRow.display_name,
          version: 2n,
          updatedAt: now,
        }),
        expectedVersion: 1n,
        labelIds: [labelId],
      }),
    ).resolves.toMatchObject({
      ownerMemberId,
      displayName: "Ada Byron",
      labels: [{ id: labelId, name: "VIP" }],
      version: 2n,
    });

    const statements = query.mock.calls.map(([text]) => text as string);
    const update = statements.find((text) => text.includes("UPDATE contacts.contacts AS contact"));
    expect(update).toContain("owner_member_id = $2::uuid");
    expect(update).toContain("contact.version = $7::bigint");
    expect(statements).toContain("BEGIN");
    expect(statements.some((text) => text.includes("DELETE FROM contacts.contact_labels"))).toBe(
      true,
    );
    expect(statements.some((text) => text.includes("INSERT INTO contacts.contact_labels"))).toBe(
      true,
    );
    expect(statements).toContain("COMMIT");
    expect(statements).not.toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rolls back a contact edit before replacing labels when a label is invalid", async () => {
    const labelId = "019b0000-0000-7000-8000-000000000023";
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes("UPDATE contacts.contacts AS contact"))
        return { rows: [{ id: contactRow.id }] };
      if (text.includes("FROM contacts.labels") && text.includes("FOR KEY SHARE"))
        return { rows: [] };
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);

    await expect(
      createCommercialPostgresRepositories(pool).contacts.update({
        actor,
        contact: Object.freeze({ ...contactRecord, version: 2n, updatedAt: now }),
        expectedVersion: 1n,
        labelIds: [labelId],
      }),
    ).rejects.toThrow("Invalid contact");

    const statements = query.mock.calls.map(([text]) => text as string);
    expect(statements).toContain("ROLLBACK");
    expect(statements.some((text) => text.includes("DELETE FROM contacts.contact_labels"))).toBe(
      false,
    );
  });

  it("resolves a bulk filter under server-side visibility and replays its compact result", async () => {
    const payloadHash = "b".repeat(64);
    let persistedResponse: unknown;
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      if (text.includes("FROM contacts.command_idempotency")) {
        return persistedResponse
          ? { rows: [{ payload_hash: payloadHash, response: persistedResponse }] }
          : { rows: [] };
      }
      if (text.includes("WITH target AS MATERIALIZED")) {
        return { rows: [{ target_count: 1, changed_count: 1 }] };
      }
      if (text.includes("UPDATE contacts.contacts AS contact")) {
        return { rows: [{ id: contactRow.id }] };
      }
      if (text.includes("INSERT INTO contacts.command_idempotency")) {
        persistedResponse = JSON.parse(String(values?.[3]));
      }
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);
    const repository = createCommercialPostgresRepositories(pool).contacts;
    const command = {
      actor,
      action: {
        action: "ARCHIVE" as const,
        target: {
          kind: "FILTER" as const,
          filter: {
            q: "Ada",
            label: "VIP",
            archived: false,
            createdFrom: new Date("2026-09-01T00:00:00.000Z"),
            createdTo: new Date("2026-09-30T23:59:59.999Z"),
          },
        },
      },
      idempotencyKey: "contact-filter-0001",
      payloadHash,
    } as const;

    const first = await repository.bulk(command);
    expect(first).toEqual({ results: [], updated: 1, unchanged: 0, notVisible: 0 });
    await expect(repository.bulk(command)).resolves.toEqual(first);

    const filterSelection = query.mock.calls.find(
      ([text]) =>
        (text as string).includes("FROM contacts.contacts AS contact") &&
        (text as string).includes("lower(label.name)") &&
        (text as string).includes("FOR UPDATE"),
    );
    expect(filterSelection).toBeDefined();
    expect(filterSelection?.[0]).toContain("contact.owner_member_id = $1::uuid");
    expect(filterSelection?.[0]).not.toContain("contact.id = ANY($1::uuid[])");
    expect(filterSelection?.[1]).toEqual([
      actor.memberId,
      "Ada",
      "VIP",
      new Date("2026-09-01T00:00:00.000Z"),
      new Date("2026-09-30T23:59:59.999Z"),
    ]);
    const statements = query.mock.calls.map(([text]) => text as string);
    expect(
      statements.filter((text) => text.includes("UPDATE contacts.contacts AS contact")),
    ).toHaveLength(1);
    expect(
      statements.filter((text) => text.includes("INSERT INTO contacts.command_idempotency")),
    ).toHaveLength(1);
  });

  it("keeps direct bulk selections compatible with per-contact visibility results", async () => {
    const hiddenContactId = "019b0000-0000-7000-8000-000000000024";
    const query = vi.fn(async (text: string, _values?: readonly unknown[]) => {
      if (text.includes("FROM contacts.command_idempotency")) return { rows: [] };
      if (text.includes("FROM contacts.contacts AS contact") && text.includes("FOR UPDATE")) {
        return { rows: [{ id: contactRow.id }] };
      }
      if (text.includes("UPDATE contacts.contacts AS contact")) {
        return { rows: [{ id: contactRow.id }] };
      }
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);

    await expect(
      createCommercialPostgresRepositories(pool).contacts.bulk({
        actor,
        action: {
          action: "ARCHIVE",
          target: { kind: "IDS", contactIds: [contactRow.id, hiddenContactId] },
        },
        idempotencyKey: "contact-ids-0001",
        payloadHash: "c".repeat(64),
      }),
    ).resolves.toEqual({
      results: [
        { contactId: contactRow.id, status: "UPDATED" },
        { contactId: hiddenContactId, status: "NOT_VISIBLE" },
      ],
      updated: 1,
      unchanged: 0,
      notVisible: 1,
    });

    const directSelection = query.mock.calls.find(
      ([text]) =>
        (text as string).includes("FROM contacts.contacts AS contact") &&
        (text as string).includes("contact.id = ANY($1::uuid[])") &&
        (text as string).includes("FOR UPDATE"),
    );
    expect(directSelection).toBeDefined();
  });

  it("combines task filters with OWN visibility and a controlled expiry instant", async () => {
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [taskRow] }));
    const pool = {
      connect: vi.fn(),
      query,
      end: vi.fn(async () => undefined),
      on: vi.fn(),
    } as unknown as PostgresPool;

    const result = await createCommercialPostgresRepositories(pool).tasks.list(
      actor,
      {
        contactId: taskRow.contact_id,
        assigneeMemberId: taskRow.assignee_member_id,
        status: "EXPIRED",
        priority: "MEDIUM",
        type: "CALL",
        dueFrom: new Date("2026-09-01T00:00:00.000Z"),
        dueTo: new Date("2026-09-30T23:59:59.000Z"),
      },
      now,
    );

    expect(result).toEqual([expect.objectContaining({ id: taskRow.id, type: "CALL" })]);
    const statement = query.mock.calls[0]?.[0] as string;
    const values = query.mock.calls[0]?.[1] as unknown[];
    expect(statement).toContain("task.created_by_member_id = $1::uuid");
    expect(statement).toContain("task.assignee_member_id = $1::uuid");
    expect(statement).toContain("task.status IN ('pending', 'in_progress')");
    expect(statement).toContain("task.due_at <=");
    expect(statement).toContain("ORDER BY task.due_at ASC NULLS LAST");
    expect(statement).toContain("LIMIT 200");
    expect(values).toEqual(
      expect.arrayContaining([
        actor.memberId,
        taskRow.contact_id,
        taskRow.assignee_member_id,
        "medium",
        "call",
        now,
      ]),
    );
  });

  it("serializes create commands and replays without duplicating task history", async () => {
    let persisted = false;
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes("FROM tasks.command_idempotency")) {
        return persisted
          ? { rows: [{ payload_hash: "a".repeat(64), response: taskRow }] }
          : { rows: [] };
      }
      if (text.includes("INSERT INTO tasks.tasks")) return { rows: [taskRow] };
      if (text.includes("INSERT INTO tasks.command_idempotency")) persisted = true;
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);
    const repository = createCommercialPostgresRepositories(pool).tasks;
    const command = {
      actor,
      task: taskRecord,
      idempotencyKey: "task-create-0001",
      payloadHash: "a".repeat(64),
    } as const;

    await expect(repository.create(command)).resolves.toMatchObject({
      type: "CALL",
      origin: "MANUAL",
    });
    await expect(repository.create(command)).resolves.toMatchObject({ id: taskRow.id });
    await expect(
      repository.create({ ...command, payloadHash: "b".repeat(64) }),
    ).rejects.toBeInstanceOf(CommercialIdempotencyConflictError);

    const statements = query.mock.calls.map(([text]) => text as string);
    expect(statements.filter((text) => text.includes("INSERT INTO tasks.tasks"))).toHaveLength(1);
    expect(statements.filter((text) => text.includes("INSERT INTO tasks.history"))).toHaveLength(1);
    expect(statements.filter((text) => text.includes("pg_advisory_xact_lock"))).toHaveLength(3);
    expect(statements.at(-1)).toBe("ROLLBACK");
  });

  it("serializes a repeated automation batch and replays it without another task", async () => {
    const automationId = "019b0000-0000-7000-8000-000000000030";
    const operationKey = "automation-run-0001";
    const payloadHash = "f".repeat(64);
    let persistedResponse: unknown;
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      if (text.includes("FROM automation.command_idempotency")) {
        return persistedResponse
          ? { rows: [{ payload_hash: payloadHash, response: persistedResponse }] }
          : { rows: [] };
      }
      if (text.includes("FROM automation.definitions")) {
        return {
          rows: [
            {
              id: automationId,
              name: "Seguimiento",
              status: "active",
              trigger_event: "CONTACT_MANUAL",
              action_type: "CREATE_TASK",
              action_config: {
                type: "CREATE_TASK",
                title: "Llamar al contacto",
                description: "Confirmar la solicitud.",
                priority: "MEDIUM",
                dueHours: 24,
              },
              version: "1",
              created_at: now,
              updated_at: now,
            },
          ],
        };
      }
      if (text.includes("FROM contacts.contacts AS contact")) {
        return { rows: [{ id: contactRow.id, owner_member_id: actor.memberId }] };
      }
      if (text.includes("FROM iam.members")) return { rows: [{ status: "active" }] };
      if (text.includes("INSERT INTO automation.command_idempotency")) {
        persistedResponse = JSON.parse(String(values?.[3]));
      }
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);
    const repository = createCommercialPostgresRepositories(pool).automation;
    const command = {
      actor,
      automationId,
      contactIds: [contactRow.id],
      operationKey,
      payloadHash,
    } as const;

    const first = await repository.activate(command);
    expect(first).toMatchObject({
      automationId,
      operationKey,
      succeeded: 1,
      failed: 0,
    });
    await expect(repository.activate(command)).resolves.toEqual(first);
    await expect(
      repository.activate({ ...command, payloadHash: "a".repeat(64) }),
    ).rejects.toBeInstanceOf(CommercialIdempotencyConflictError);

    const statements = query.mock.calls.map(([text]) => text as string);
    expect(statements.filter((text) => text.includes("INSERT INTO tasks.tasks"))).toHaveLength(1);
    expect(statements.filter((text) => text.includes("FROM automation.definitions"))).toHaveLength(
      1,
    );
    expect(statements.filter((text) => text.includes("pg_advisory_xact_lock"))).toHaveLength(3);
    const commandLock = query.mock.calls.find(
      ([text, values]) =>
        (text as string).includes("pg_advisory_xact_lock") &&
        (values as readonly unknown[] | undefined)?.[0] ===
          `${actor.memberId}:automation.activate:${operationKey}`,
    );
    expect(commandLock).toBeDefined();
    const lockIndex = query.mock.calls.indexOf(commandLock!);
    const replayIndex = query.mock.calls.findIndex(([text]) =>
      (text as string).includes("FROM automation.command_idempotency"),
    );
    expect(lockIndex).toBeLessThan(replayIndex);
  });

  it("records closure actor, timestamp and one status history row across a replay", async () => {
    const completedRow = Object.freeze({
      ...taskRow,
      status: "completed",
      completed_at: now,
      completed_by_member_id: actor.memberId,
      version: "2",
      updated_at: now,
    });
    let persisted = false;
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes("FROM tasks.command_idempotency")) {
        return persisted
          ? { rows: [{ payload_hash: "c".repeat(64), response: completedRow }] }
          : { rows: [] };
      }
      if (text.includes("FROM tasks.tasks AS task") && text.includes("FOR UPDATE"))
        return { rows: [taskRow] };
      if (text.includes("UPDATE tasks.tasks AS task")) return { rows: [completedRow] };
      if (text.includes("INSERT INTO tasks.command_idempotency")) persisted = true;
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);
    const repository = createCommercialPostgresRepositories(pool).tasks;
    const command = {
      actor,
      id: taskRow.id,
      status: "COMPLETED" as const,
      expectedVersion: 1n,
      now,
      idempotencyKey: "task-status-0001",
      payloadHash: "c".repeat(64),
    };

    await expect(repository.updateStatus(command)).resolves.toMatchObject({
      status: "COMPLETED",
      completedAt: now,
      completedByMemberId: actor.memberId,
      version: 2n,
    });
    await expect(repository.updateStatus(command)).resolves.toMatchObject({ version: 2n });

    const statements = query.mock.calls.map(([text]) => text as string);
    const update = statements.find((text) => text.includes("UPDATE tasks.tasks AS task"));
    expect(update).toContain("completed_at = CASE");
    expect(update).toContain("completed_by_member_id = CASE");
    expect(update).toContain("task.version = $5::bigint");
    expect(
      statements.filter(
        (text) => text.includes("INSERT INTO tasks.history") && text.includes("status_changed"),
      ),
    ).toHaveLength(1);
  });

  it("writes assignee history and preserves optimistic concurrency on edits", async () => {
    const reassignedRow = Object.freeze({
      ...taskRow,
      assignee_member_id: "019b0000-0000-7000-8000-000000000007",
      title: "Updated task",
      version: "2",
      updated_at: now,
    });
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes("FROM tasks.command_idempotency")) return { rows: [] };
      if (text.includes("FROM tasks.tasks AS task") && text.includes("FOR UPDATE"))
        return { rows: [taskRow] };
      if (text.includes("UPDATE tasks.tasks AS task")) return { rows: [reassignedRow] };
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);

    await expect(
      createCommercialPostgresRepositories(pool).tasks.update({
        actor,
        id: taskRow.id,
        patch: { assigneeMemberId: reassignedRow.assignee_member_id, title: reassignedRow.title },
        expectedVersion: 1n,
        now,
        idempotencyKey: "task-update-0001",
        payloadHash: "d".repeat(64),
      }),
    ).resolves.toMatchObject({ assigneeMemberId: reassignedRow.assignee_member_id, version: 2n });

    const historyCall = query.mock.calls.find(
      ([text]) =>
        (text as string).includes("INSERT INTO tasks.history") &&
        (text as string).includes("'assignee_changed'"),
    );
    expect(historyCall?.[1]).toEqual(expect.arrayContaining([actor.memberId]));
    const update = query.mock.calls
      .map(([text]) => text as string)
      .find((text) => text.includes("UPDATE tasks.tasks AS task"));
    expect(update).toContain("task.version = $15::bigint");
  });

  it("replays an internal comment without duplicating comment or history rows", async () => {
    const commentRow = Object.freeze({
      id: "019b0000-0000-7000-8000-000000000011",
      task_id: taskRow.id,
      author_member_id: actor.memberId,
      body: "Customer confirmed",
      created_at: now,
    });
    let persisted = false;
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes("FROM tasks.command_idempotency")) {
        return persisted
          ? { rows: [{ payload_hash: "e".repeat(64), response: commentRow }] }
          : { rows: [] };
      }
      if (text.includes("SELECT task.id::text")) return { rows: [{ id: taskRow.id }] };
      if (text.includes("INSERT INTO tasks.comments")) return { rows: [commentRow] };
      if (text.includes("INSERT INTO tasks.command_idempotency")) persisted = true;
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);
    const repository = createCommercialPostgresRepositories(pool).tasks;
    const command = {
      actor,
      taskId: taskRow.id,
      comment: {
        id: commentRow.id,
        taskId: taskRow.id,
        authorMemberId: actor.memberId,
        body: commentRow.body,
        createdAt: now,
      },
      idempotencyKey: "task-comment-0001",
      payloadHash: "e".repeat(64),
    } as const;

    await expect(repository.addComment(command)).resolves.toMatchObject({ body: commentRow.body });
    await expect(repository.addComment(command)).resolves.toMatchObject({ id: commentRow.id });

    const statements = query.mock.calls.map(([text]) => text as string);
    expect(statements.filter((text) => text.includes("INSERT INTO tasks.comments"))).toHaveLength(
      1,
    );
    expect(
      statements.filter(
        (text) => text.includes("INSERT INTO tasks.history") && text.includes("commented"),
      ),
    ).toHaveLength(1);
  });

  it("scopes comment and history reads through the parent task", async () => {
    const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [] }));
    const pool = {
      connect: vi.fn(),
      query,
      end: vi.fn(async () => undefined),
      on: vi.fn(),
    } as unknown as PostgresPool;
    const repository = createCommercialPostgresRepositories(pool).tasks;

    await repository.listComments(actor, taskRow.id);
    await repository.listHistory(actor, taskRow.id);

    for (const [statement, values] of query.mock.calls) {
      expect(statement as string).toContain("JOIN tasks.tasks AS task");
      expect(statement as string).toContain("task.created_by_member_id = $2::uuid");
      expect(statement as string).toContain("task.assignee_member_id = $2::uuid");
      expect(values).toEqual([taskRow.id, actor.memberId]);
    }
  });
});
