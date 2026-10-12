import type { ServiceTokenClient } from "@quantum-crm/auth";
import { AgentConversationContextSchema } from "@quantum-crm/contracts";
import { z } from "zod";

import type { RagGateway } from "./rag-graph.js";

const searchResultSchema = z.object({
  sources: z
    .array(
      z.object({
        id: z.string().uuid(),
        catalog: z.enum(["individual", "corporativo"]),
        page: z.number().int().positive().max(1_000),
        text: z.string().min(1).max(4_000),
        revision: z.string().min(1).max(128),
      }),
    )
    .max(8),
});

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
  isError: z.literal(false),
});

/** A single execution-scoped MCP connection; no caller-chosen conversation ID. */
export function createMcpAgentClient(input: {
  readonly executionId: string;
  readonly tokenClient: ServiceTokenClient;
  readonly fetcher?: typeof fetch;
}): {
  readonly context: () => Promise<z.infer<typeof AgentConversationContextSchema>>;
  readonly search: RagGateway["search"];
} {
  const endpoint = "http://api:3001/mcp";
  let tokenPromise: ReturnType<ServiceTokenClient["issue"]> | undefined;
  let nextId = 0;
  let initialized = false;
  const call = async (method: string, params?: unknown): Promise<unknown> => {
    tokenPromise ??= input.tokenClient.issue();
    const token = await tokenPromise;
    const id = ++nextId;
    const response = await (input.fetcher ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.expose()}`,
        "X-QCRM-Execution-Id": input.executionId,
        "MCP-Protocol-Version": "2025-03-26",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`MCP_HTTP_${response.status}`);
    const payload = z
      .object({ jsonrpc: z.literal("2.0"), id: z.literal(id), result: z.unknown() })
      .parse(await response.json());
    return payload.result;
  };
  const tool = async (name: string, args: unknown): Promise<unknown> => {
    if (!initialized) {
      z.object({ protocolVersion: z.literal("2025-03-26") }).parse(
        await call("initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "quantum-agent-runtime", version: "1.0.0" },
        }),
      );
      initialized = true;
    }
    const result = toolResultSchema.parse(await call("tools/call", { name, arguments: args }));
    return JSON.parse(result.content[0]!.text) as unknown;
  };
  return Object.freeze({
    context: async () =>
      AgentConversationContextSchema.parse(await tool("conversation.context.v1", {})),
    search: async (request) => {
      const sources = searchResultSchema.parse(await tool("catalog.search.v1", request)).sources;
      if (sources.some((source) => source.catalog !== request.catalog))
        throw new Error("MCP returned a cross-catalog source");
      return sources;
    },
  });
}
