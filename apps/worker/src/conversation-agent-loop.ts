import { randomUUID } from "node:crypto";

import type { ServiceTokenClient } from "@quantum-crm/auth";
import type { ConversationAgentDispatcher, ConversationAgentLease } from "@quantum-crm/domain";
import { z } from "zod";

const agentResultSchema = z.object({
  answer: z.string().trim().min(1).max(4_000),
  sourceIds: z.array(z.string().uuid()).max(8),
  grounded: z.boolean(),
  handoffRequested: z.boolean().optional(),
});

export interface ConversationAgentLoop {
  readonly close: () => Promise<void>;
}

export interface ConversationAgentLoopOptions {
  readonly repository: ConversationAgentDispatcher;
  readonly tokenClient: ServiceTokenClient;
  readonly sourcesReady: () => Promise<boolean>;
  readonly routeAdvisor?: (lease: ConversationAgentLease) => Promise<boolean>;
  readonly tenantId: string;
  readonly pollIntervalMs: number;
  readonly workerId?: string;
  readonly fetcher?: typeof fetch;
  readonly onError?: (error: unknown) => void;
}

export async function dispatchAgentRequest(
  options: ConversationAgentLoopOptions,
  lease: ConversationAgentLease,
  workerId: string,
): Promise<void> {
  try {
    const token = await options.tokenClient.issue();
    const response = await (options.fetcher ?? fetch)("http://agent-runtime:3104/agent/v1/run", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token.expose()}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        tenantId: options.tenantId,
        executionId: lease.inboundMessageId,
        question: lease.question,
        firstTurn: lease.firstTurn,
      }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(70_000),
    });
    if (!response.ok) throw new Error("Agent runtime unavailable");
    const result = agentResultSchema.parse(await response.json());
    const routed =
      result.handoffRequested === true && options.routeAdvisor
        ? await options.routeAdvisor(lease)
        : false;
    const persisted = await options.repository.complete({
      lease,
      workerId,
      answer: result.answer,
      sourceIds: result.sourceIds,
      ...(routed ? { handoffRequested: true } : {}),
    });
    if (persisted === "STALE") throw new Error("Agent request lease lost");
  } catch (error) {
    await options.repository.fail({
      lease,
      workerId,
      retry: true,
      code: "AGENT_UNAVAILABLE",
    });
    throw error;
  }
}

export function startConversationAgentLoop(
  options: ConversationAgentLoopOptions,
): ConversationAgentLoop {
  const workerId = options.workerId ?? randomUUID();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = Promise.resolve();
  const schedule = () => {
    if (closed) return;
    timer = setTimeout(() => {
      running = tick();
    }, options.pollIntervalMs);
    timer.unref();
  };
  const tick = async (): Promise<void> => {
    if (closed) return;
    try {
      if (!(await options.sourcesReady())) return;
      const lease = await options.repository.claimNext({ workerId, leaseSeconds: 90 });
      if (lease) await dispatchAgentRequest(options, lease, workerId);
    } catch (error) {
      options.onError?.(error);
    } finally {
      schedule();
    }
  };
  running = tick();
  return Object.freeze({
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  });
}
