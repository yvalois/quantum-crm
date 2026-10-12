import type { ServiceTokenClient } from "@quantum-crm/auth";
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

export function createMcpCatalogSearch(input: {
  readonly executionId: string;
  readonly tokenClient: ServiceTokenClient;
  readonly fetcher?: typeof fetch;
}): RagGateway["search"] {
  const endpoint = "http://api:3001/mcp";
  return async (request) => {
    const token = await input.tokenClient.issue();
    const call = async (id: number, method: string, params?: unknown): Promise<unknown> => {
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
      if (!response.ok) throw new Error("MCP catalog request failed");
      const payload = z
        .object({ jsonrpc: z.literal("2.0"), id: z.literal(id), result: z.unknown() })
        .parse(await response.json());
      return payload.result;
    };
    const initialized = z.object({ protocolVersion: z.literal("2025-03-26") }).parse(
      await call(1, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "quantum-agent-runtime", version: "1.0.0" },
      }),
    );
    if (initialized.protocolVersion !== "2025-03-26") throw new Error("MCP version mismatch");
    const result = z
      .object({
        content: z.array(z.object({ type: z.literal("text"), text: z.string() })).min(1),
        isError: z.literal(false),
      })
      .parse(
        await call(2, "tools/call", {
          name: "catalog.search.v1",
          arguments: request,
        }),
      );
    const sources = searchResultSchema.parse(JSON.parse(result.content[0]!.text)).sources;
    if (sources.some((source) => source.catalog !== request.catalog))
      throw new Error("MCP returned a cross-catalog source");
    return sources;
  };
}
