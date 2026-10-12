import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import { createMcpAgentClient } from "./mcp-catalog-client.js";

describe("execution-scoped MCP client", () => {
  it("reads one thread context and its catalog with one service token", async () => {
    const executionId = "019b0000-0000-7000-8000-000000000001";
    const issue = vi.fn(async () => new SecretValue("test-token"));
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        id: number;
        method: string;
        params?: { name: string };
      };
      expect((init?.headers as Record<string, string>)["X-QCRM-Execution-Id"]).toBe(executionId);
      const result =
        body.method === "initialize"
          ? { protocolVersion: "2025-03-26" }
          : {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    body.params?.name === "conversation.context.v1"
                      ? {
                          threadId: "019b0000-0000-7000-8000-000000000002",
                          messages: [{ role: "customer", text: "Individual" }],
                        }
                      : {
                          sources: [
                            {
                              id: "019b0000-0000-7000-8000-000000000003",
                              catalog: "individual",
                              page: 1,
                              text: "Catalogo individual",
                              revision: "rev-1",
                            },
                          ],
                        },
                  ),
                },
              ],
              isError: false,
            };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
    });
    const client = createMcpAgentClient({ executionId, tokenClient: { issue }, fetcher });
    expect((await client.context()).messages[0]?.text).toBe("Individual");
    expect(
      (await client.search({ catalog: "individual", question: "Cobertura", limit: 8 })).length,
    ).toBe(1);
    expect(issue).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
