import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { OIDC_ACCESS_TOKEN_VERIFIER, type OidcAccessTokenVerifier } from "@quantum-crm/auth";
import { SecretValue } from "@quantum-crm/config";
import { POSTGRES_DATABASE, type CrmPostgresDatabase } from "@quantum-crm/database";
import { z } from "zod";

import { CrmPublicRoute } from "./crm-security.js";

const uuid = z.string().uuid();
const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string().max(128), z.number().int()]).optional(),
  method: z.enum(["initialize", "notifications/initialized", "tools/list", "tools/call"]),
  params: z.unknown().optional(),
});
const searchInputSchema = z
  .object({
    name: z.literal("catalog.search.v1"),
    arguments: z
      .object({
        catalog: z.enum(["individual", "corporativo"]),
        question: z.string().trim().min(3).max(2_000),
        limit: z.number().int().min(1).max(8),
      })
      .strict(),
  })
  .strict();

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

/** Minimal stateless Streamable HTTP gateway for the first read-only tool. */
@Controller("mcp")
@CrmPublicRoute()
export class AgentMcpController {
  public constructor(
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER) private readonly verifier: OidcAccessTokenVerifier,
    @Inject(POSTGRES_DATABASE) private readonly database: CrmPostgresDatabase,
  ) {}

  @Post()
  @HttpCode(200)
  public async call(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-qcrm-execution-id") executionId: string | undefined,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<unknown> {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("MCP-Protocol-Version", "2025-03-26");
    const bearer =
      typeof authorization === "string"
        ? /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/u.exec(authorization)?.[1]
        : undefined;
    if (!bearer || !uuid.safeParse(executionId).success) throw new UnauthorizedException();
    try {
      const identity = await this.verifier.verifyAccessToken(new SecretValue(bearer));
      if (
        identity.principalType !== "service" ||
        identity.clientId !== "quantum-agent-runtime" ||
        !identity.audiences.includes("quantum-crm-api") ||
        !identity.servicePermissions?.includes("agents:catalog-search") ||
        !(await this.database.commercial.conversationAgent.isLeasedExecution(executionId!))
      )
        throw new UnauthorizedException();
    } catch {
      throw new UnauthorizedException();
    }
    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) throw new BadRequestException();
    const { id, method, params } = parsed.data;
    if (method === "notifications/initialized") return null;
    if (id === undefined) throw new BadRequestException();
    if (method === "initialize")
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "quantum-catalog-mcp", version: "1.0.0" },
        },
      };
    if (method === "tools/list")
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "catalog.search.v1",
              description: "Busca fragmentos del catálogo seleccionado",
              inputSchema: {
                type: "object",
                properties: {
                  catalog: { type: "string", enum: ["individual", "corporativo"] },
                  question: { type: "string" },
                  limit: { type: "integer", minimum: 1, maximum: 8 },
                },
                required: ["catalog", "question", "limit"],
                additionalProperties: false,
              },
            },
          ],
        },
      };
    const input = searchInputSchema.safeParse(params);
    if (!input.success) throw new BadRequestException();
    const hits = await this.database.commercial.agentKnowledge.search(input.data.arguments);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify({ sources: hits }) }],
        isError: false,
      },
    };
  }
}
