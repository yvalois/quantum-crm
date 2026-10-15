import { SecretValue } from "@quantum-crm/config";
import type { ConversationAgentDispatcher, ConversationAgentLease } from "@quantum-crm/domain";
import { describe, expect, it, vi } from "vitest";

import { dispatchAgentRequest, startConversationAgentLoop } from "./conversation-agent-loop.js";

const lease: ConversationAgentLease = {
  inboundMessageId: "019b0000-0000-7000-8000-000000000001",
  conversationId: "019b0000-0000-7000-8000-000000000002",
  question: "Catalogo corporativo",
  generation: 1n,
  firstTurn: true,
};

describe("conversation agent dispatch", () => {
  it("does not claim customer messages until both scanned catalogs are active", async () => {
    const claimNext = vi.fn();
    const loop = startConversationAgentLoop({
      repository: { claimNext } as unknown as ConversationAgentDispatcher,
      sourcesReady: async () => false,
      tokenClient: { issue: async () => new SecretValue("fake-service-token") },
      tenantId: "019b0000-0000-7000-8000-000000000003",
      pollIntervalMs: 2_000,
    });
    await loop.close();
    expect(claimNext).not.toHaveBeenCalled();
  });

  it("persists the cited response once before the outbound worker sends it", async () => {
    const complete = vi.fn(async () => "COMPLETED" as const);
    const fail = vi.fn();
    const routeAdvisor = vi.fn(async () => true);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        tenantId: "019b0000-0000-7000-8000-000000000003",
        executionId: lease.inboundMessageId,
        question: lease.question,
        firstTurn: true,
      });
      expect(init?.headers).toMatchObject({ authorization: "Bearer fake-service-token" });
      return new Response(
        JSON.stringify({
          answer: "Segun el catalogo, hay opciones corporativas.",
          sourceIds: ["019b0000-0000-7000-8000-000000000004"],
          grounded: true,
        }),
        { status: 200 },
      );
    });
    await dispatchAgentRequest(
      {
        repository: { complete, fail } as unknown as ConversationAgentDispatcher,
        routeAdvisor,
        sourcesReady: async () => true,
        tokenClient: { issue: async () => new SecretValue("fake-service-token") },
        tenantId: "019b0000-0000-7000-8000-000000000003",
        pollIntervalMs: 2_000,
        fetcher,
      },
      lease,
      "test-worker",
    );
    expect(complete).toHaveBeenCalledWith({
      lease,
      workerId: "test-worker",
      answer: "Segun el catalogo, hay opciones corporativas.",
      sourceIds: ["019b0000-0000-7000-8000-000000000004"],
    });
    expect(fail).not.toHaveBeenCalled();
    expect(routeAdvisor).not.toHaveBeenCalled();
  });

  it("releases a failed execution for a bounded retry", async () => {
    const complete = vi.fn();
    const fail = vi.fn(async () => true);
    await expect(
      dispatchAgentRequest(
        {
          repository: { complete, fail } as unknown as ConversationAgentDispatcher,
          sourcesReady: async () => true,
          tokenClient: { issue: async () => new SecretValue("fake-service-token") },
          tenantId: "019b0000-0000-7000-8000-000000000003",
          pollIntervalMs: 2_000,
          fetcher: vi.fn(async () => new Response(null, { status: 503 })),
        },
        lease,
        "test-worker",
      ),
    ).rejects.toThrow("Agent runtime unavailable");
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith({
      lease,
      workerId: "test-worker",
      retry: true,
      code: "AGENT_UNAVAILABLE",
    });
  });

  it("passes a validated handoff proposal to the fenced completion", async () => {
    const complete = vi.fn(async () => "COMPLETED" as const);
    const routeAdvisor = vi.fn(async () => true);
    await dispatchAgentRequest(
      {
        repository: { complete, fail: vi.fn() } as unknown as ConversationAgentDispatcher,
        routeAdvisor,
        sourcesReady: async () => true,
        tokenClient: { issue: async () => new SecretValue("fake-service-token") },
        tenantId: "019b0000-0000-7000-8000-000000000003",
        pollIntervalMs: 2_000,
        fetcher: vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                answer: "Validaremos disponibilidad.",
                sourceIds: [],
                grounded: false,
                handoffRequested: true,
              }),
              { status: 200 },
            ),
        ),
      },
      lease,
      "test-worker",
    );
    expect(routeAdvisor).toHaveBeenCalledWith(lease);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ handoffRequested: true }));
  });
});
