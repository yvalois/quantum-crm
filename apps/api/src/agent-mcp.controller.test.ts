import { UnauthorizedException } from "@nestjs/common";
import type { OidcAccessTokenVerifier } from "@quantum-crm/auth";
import type { CrmPostgresDatabase } from "@quantum-crm/database";
import { describe, expect, it, vi } from "vitest";

import { AgentMcpController } from "./agent-mcp.controller.js";

const executionId = "019b0000-0000-7000-8000-000000000001";
const sourceId = "019b0000-0000-7000-8000-000000000002";
const identity = {
  principalType: "service",
  clientId: "quantum-agent-runtime",
  audiences: ["quantum-crm-api"],
  servicePermissions: ["agents:catalog-search", "agents:conversation-context"],
};
const body = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: {
    name: "catalog.search.v1",
    arguments: {
      catalog: "individual",
      question: "Cobertura individual",
      limit: 8,
    },
  },
};

function setup(leased: boolean, permissions = identity.servicePermissions) {
  const verifyAccessToken = vi.fn(async () => ({ ...identity, servicePermissions: permissions }));
  const isLeasedExecution = vi.fn(async () => leased);
  const search = vi.fn(async () => [
    {
      id: sourceId,
      catalog: "individual",
      page: 2,
      text: "Cobertura indicada en el catalogo",
      revision: "revision",
    },
  ]);
  const contextForExecution = vi.fn(async () => ({
    threadId: "019b0000-0000-7000-8000-000000000003",
    messages: [{ role: "customer", text: "Busco alquiler individual" }],
  }));
  const stub = {
    commercial: {
      conversationAgent: { isLeasedExecution, contextForExecution },
      agentKnowledge: { search },
    },
  };
  const database = stub as unknown as CrmPostgresDatabase;
  const controller = new AgentMcpController(
    { verifyAccessToken } as unknown as OidcAccessTokenVerifier,
    database,
  );
  return { controller, verifyAccessToken, isLeasedExecution, contextForExecution, search };
}

describe("agent MCP gateway", () => {
  it("requires a live leased execution and a scoped service permission", async () => {
    const response = { setHeader: vi.fn() };
    const denied = setup(false);
    await expect(
      denied.controller.call("Bearer fake.jwt.token", executionId, body, response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(denied.search).not.toHaveBeenCalled();

    const missingPermission = setup(true, []);
    await expect(
      missingPermission.controller.call("Bearer fake.jwt.token", executionId, body, response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(missingPermission.search).not.toHaveBeenCalled();
  });

  it("returns only catalog hits for an authorized execution", async () => {
    const { controller, search } = setup(true);
    const response = { setHeader: vi.fn() };
    const result = await controller.call("Bearer fake.jwt.token", executionId, body, response);
    expect(search).toHaveBeenCalledWith({
      catalog: "individual",
      question: "Cobertura individual",
      limit: 8,
    });
    expect(result).toMatchObject({ jsonrpc: "2.0", id: 2, result: { isError: false } });
  });

  it("reads only the conversation bound to the leased execution", async () => {
    const { controller, contextForExecution } = setup(true);
    const result = (await controller.call(
      "Bearer fake.jwt.token",
      executionId,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "conversation.context.v1",
          arguments: {},
        },
      },
      { setHeader: vi.fn() },
    )) as { result: { content: Array<{ text: string }> } };
    expect(contextForExecution).toHaveBeenCalledWith(executionId);
    expect(JSON.parse(result.result.content[0]!.text)).toEqual({
      threadId: "019b0000-0000-7000-8000-000000000003",
      messages: [{ role: "customer", text: "Busco alquiler individual" }],
    });
  });

  it("does not let a catalog-only principal read conversation context", async () => {
    const { controller, contextForExecution } = setup(true, ["agents:catalog-search"]);
    await expect(
      controller.call(
        "Bearer fake.jwt.token",
        executionId,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "conversation.context.v1",
            arguments: {},
          },
        },
        { setHeader: vi.fn() },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(contextForExecution).not.toHaveBeenCalled();
  });
});
