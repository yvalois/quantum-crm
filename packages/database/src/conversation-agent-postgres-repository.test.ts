import { describe, expect, it, vi } from "vitest";

import { createConversationAgentPostgresRepository } from "./conversation-agent-postgres-repository.js";
import type { PostgresPool } from "./postgres-database.js";

describe("conversation agent PostgreSQL repository", () => {
  it.each([true, false])(
    "only switches to a human when the routed advisor is still confirmed (receipt=%s)",
    async (hasReceipt) => {
      const query = vi.fn(async (statement: string, _values?: unknown[]) => {
        if (statement.includes("SELECT enabled FROM conversations.agent_control"))
          return { rows: [{ enabled: true }] };
        if (statement.includes("SELECT contact_id::text, assignee_member_id::text"))
          return {
            rows: [
              {
                contact_id: "019b0000-0000-7000-8000-000000000003",
                assignee_member_id: "019b0000-0000-7000-8000-000000000004",
                attention_mode: "agent",
                status: "open",
                channel: "whatsapp",
              },
            ],
          };
        if (statement.includes("lease_expires_at > CURRENT_TIMESTAMP AS lease_valid"))
          return {
            rows: [
              { status: "leased", lease_owner: "worker", lease_generation: "1", lease_valid: true },
            ],
          };
        if (statement.includes("SELECT 1 FROM conversations.advisor_route_assignments"))
          return { rows: hasReceipt ? [{ "?column?": 1 }] : [], rowCount: hasReceipt ? 1 : 0 };
        if (statement.includes("COALESCE(MAX(sequence)")) return { rows: [{ sequence: "2" }] };
        return { rows: [], rowCount: 1 };
      });
      const pool = {
        connect: vi.fn(async () => ({ query, release: vi.fn() })),
      } as unknown as PostgresPool;
      const result = await createConversationAgentPostgresRepository(pool).complete({
        lease: {
          inboundMessageId: "019b0000-0000-7000-8000-000000000001",
          conversationId: "019b0000-0000-7000-8000-000000000002",
          question: "Cumplo los requisitos",
          generation: 1n,
          firstTurn: false,
        },
        workerId: "worker",
        answer: "Validaremos disponibilidad.",
        sourceIds: [],
        handoffRequested: true,
      });
      expect(result).toBe("COMPLETED");
      const update = query.mock.calls.find(([statement]) =>
        statement.includes("UPDATE conversations.conversations SET last_message_preview"),
      );
      expect(update?.[1]?.[2]).toBe(hasReceipt);
      expect(
        query.mock.calls.some(([statement]) => statement.includes("'attention_changed'")),
      ).toBe(hasReceipt);
    },
  );

  it("reads a bounded, reset-scoped transcript for the leased execution only", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          thread_id: "019b0000-0000-7000-8000-000000000002",
          direction: "inbound",
          from_advisor: false,
          body: "Hola",
        },
        {
          thread_id: "019b0000-0000-7000-8000-000000000002",
          direction: "outbound",
          from_advisor: true,
          body: "Te atiendo",
        },
        {
          thread_id: "019b0000-0000-7000-8000-000000000002",
          direction: "outbound",
          from_advisor: false,
          body: "Soy Alex",
        },
      ],
    }));
    const pool = { query } as unknown as PostgresPool;
    const context = await createConversationAgentPostgresRepository(pool).contextForExecution(
      "019b0000-0000-7000-8000-000000000001",
    );
    expect(context).toEqual({
      threadId: "019b0000-0000-7000-8000-000000000002",
      messages: [
        { role: "customer", text: "Hola" },
        { role: "advisor", text: "Te atiendo" },
        { role: "agent", text: "Soy Alex" },
      ],
    });
    expect(query.mock.calls[0]?.[0]).toContain("message.sequence > execution.agent_reset_sequence");
    expect(query.mock.calls[0]?.[0]).toContain("request.status = 'leased'");
    expect(query.mock.calls[0]?.[1]).toEqual(["019b0000-0000-7000-8000-000000000001"]);
  });

  it("derives first turn from completed requests since the last reset", async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes("NOT EXISTS ("))
        return {
          rows: [
            {
              inbound_message_id: "019b0000-0000-7000-8000-000000000001",
              conversation_id: "019b0000-0000-7000-8000-000000000002",
              question: "Hola",
              lease_generation: "0",
              first_turn: true,
            },
          ],
        };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) } as unknown as PostgresPool;
    const lease = await createConversationAgentPostgresRepository(pool).claimNext({
      workerId: "test-worker",
      leaseSeconds: 90,
    });
    expect(lease?.firstTurn).toBe(true);
    expect(
      query.mock.calls.find(([statement]) => statement.includes("NOT EXISTS ("))?.[0],
    ).toContain("conversation.agent_reset_at");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
});
