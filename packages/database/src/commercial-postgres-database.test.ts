import type { CommercialActor, Pipeline, TaskRecord } from "@quantum-crm/domain";
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

describe("commercial PostgreSQL task repository", () => {
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

describe("commercial PostgreSQL sales repository", () => {
  const pipelineId = "019b0000-0000-7000-8000-000000000101";
  const pipelineRow = Object.freeze({
    id: pipelineId,
    name: "Ventas corporativas",
    description: "Proceso B2B",
    created_at: now,
  });
  const stageRows = Object.freeze([
    Object.freeze({
      id: "019b0000-0000-7000-8000-000000000102",
      pipeline_id: pipelineId,
      name: "Descubrimiento",
      description: "Necesidad validada",
      position: 0,
    }),
    Object.freeze({
      id: "019b0000-0000-7000-8000-000000000103",
      pipeline_id: pipelineId,
      name: "Propuesta",
      description: "Oferta enviada",
      position: 1,
    }),
  ]);
  const pipeline: Pipeline = Object.freeze({
    id: pipelineId,
    name: pipelineRow.name,
    description: pipelineRow.description,
    stages: Object.freeze(
      stageRows.map((stage) =>
        Object.freeze({
          id: stage.id,
          pipelineId: stage.pipeline_id,
          name: stage.name,
          description: stage.description,
          position: stage.position,
        }),
      ),
    ),
    createdAt: now,
  });
  const command = Object.freeze({
    actor,
    pipeline,
    idempotencyKey: "pipeline-create-0001",
    payloadHash: "f".repeat(64),
  });

  it("creates pipeline and initial stages once in one transaction and replays the stages", async () => {
    let persisted = false;
    let insertedStages = 0;
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes("FROM sales.command_idempotency")) {
        return persisted
          ? { rows: [{ payload_hash: command.payloadHash, response: pipelineRow }] }
          : { rows: [] };
      }
      if (text.includes("INSERT INTO sales.pipelines")) return { rows: [pipelineRow] };
      if (text.includes("INSERT INTO sales.pipeline_stages")) {
        const row = stageRows[insertedStages];
        insertedStages += 1;
        return { rows: row ? [row] : [] };
      }
      if (text.includes("INSERT INTO sales.command_idempotency")) persisted = true;
      return { rows: [] };
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const poolQuery = vi.fn(async (text: string) => {
      if (text.includes("FROM sales.pipeline_stages")) return { rows: stageRows };
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => client),
      query: poolQuery,
      end: vi.fn(async () => undefined),
      on: vi.fn(),
    } as unknown as PostgresPool;
    const repository = createCommercialPostgresRepositories(pool).sales;

    await expect(repository.createPipeline(command)).resolves.toMatchObject({
      id: pipelineId,
      stages: [
        { name: "Descubrimiento", position: 0 },
        { name: "Propuesta", position: 1 },
      ],
    });
    await expect(repository.createPipeline(command)).resolves.toMatchObject({
      id: pipelineId,
      stages: [
        { name: "Descubrimiento", position: 0 },
        { name: "Propuesta", position: 1 },
      ],
    });

    const statements = query.mock.calls.map(([text]) => text as string);
    expect(statements.filter((text) => text === "BEGIN")).toHaveLength(2);
    expect(statements.filter((text) => text === "COMMIT")).toHaveLength(2);
    expect(
      statements.filter((text) => text.includes("pg_advisory_xact_lock")),
    ).toHaveLength(2);
    expect(statements.filter((text) => text.includes("INSERT INTO sales.pipelines"))).toHaveLength(
      1,
    );
    expect(
      statements.filter((text) => text.includes("INSERT INTO sales.pipeline_stages")),
    ).toHaveLength(2);
    expect(
      statements.filter((text) => text.includes("INSERT INTO sales.command_idempotency")),
    ).toHaveLength(1);
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it("rolls back the pipeline when an initial-stage write fails", async () => {
    let stageWrites = 0;
    const query = vi.fn(async (text: string, _values?: unknown[]) => {
      if (text.includes("FROM sales.command_idempotency")) return { rows: [] };
      if (text.includes("INSERT INTO sales.pipelines")) return { rows: [pipelineRow] };
      if (text.includes("INSERT INTO sales.pipeline_stages")) {
        stageWrites += 1;
        if (stageWrites === 2) throw new Error("stage write failed");
        return { rows: [stageRows[0]] };
      }
      return { rows: [] };
    });
    const { pool } = poolWithClientQuery(query);
    const repository = createCommercialPostgresRepositories(pool).sales;

    await expect(repository.createPipeline(command)).rejects.toThrow();

    const statements = query.mock.calls.map(([text]) => text as string);
    expect(
      statements.filter((text) => text.includes("pg_advisory_xact_lock")),
    ).toHaveLength(1);
    expect(statements.filter((text) => text.includes("INSERT INTO sales.pipelines"))).toHaveLength(
      1,
    );
    expect(
      statements.filter((text) => text.includes("INSERT INTO sales.pipeline_stages")),
    ).toHaveLength(2);
    expect(
      statements.filter((text) => text.includes("INSERT INTO sales.command_idempotency")),
    ).toHaveLength(0);
    expect(statements.at(-1)).toBe("ROLLBACK");
  });
});
