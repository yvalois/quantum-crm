import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createKeycloakOidcAccessTokenVerifier, createServiceTokenClient } from "@quantum-crm/auth";
import { loadServiceConfig, requireOidcConfig, SecretValue } from "@quantum-crm/config";
import { createInternalHealthServer, registerGracefulShutdown } from "@quantum-crm/observability";
import { z } from "zod";

import { createMcpCatalogSearch } from "./mcp-catalog-client.js";
import { briefIntroduction, noCatalogAnswer } from "./interamerican-greeting.js";
import { createOpenAiRagAnswer } from "./openai-rag-answer.js";
import { askCatalog } from "./rag-graph.js";

const requestSchema = z
  .object({
    tenantId: z.string().uuid(),
    executionId: z.string().uuid(),
    question: z.string().trim().min(3).max(2_000),
    firstTurn: z.boolean(),
  })
  .strict();

function catalogFor(question: string): "individual" | "corporativo" | null {
  const corporate = /\b(corporativ[oa]|empresa|empresarial|flota|convenio)\b/iu.test(question);
  const individual = /\b(individual|personal|particular|familia|turismo)\b/iu.test(question);
  if (corporate === individual) return null;
  return corporate ? "corporativo" : "individual";
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = chunk as Uint8Array;
    size += bytes.byteLength;
    if (size > 8_192) throw new Error("Request too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store, max-age=0",
  });
  response.end(JSON.stringify(body));
}

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("agent-runtime");
  const oidc = requireOidcConfig(config);
  if (
    !config.tenantId ||
    !oidc.issuer.endsWith(`/realms/qcrm-${config.tenantId.replaceAll("-", "")}`)
  )
    throw new Error("Agent realm/profile mismatch");
  const verifier = createKeycloakOidcAccessTokenVerifier(oidc, {
    expectedPrincipalType: "service",
  });
  const mcpTokenClient = config.agentRuntimeSecret
    ? createServiceTokenClient({
        issuer: oidc.issuer,
        clientId: "quantum-agent-runtime",
        clientSecret: config.agentRuntimeSecret,
      })
    : undefined;
  const answer = config.openAiApiKey
    ? createOpenAiRagAnswer({ apiKey: config.openAiApiKey })
    : undefined;
  let ready = false;
  const healthServer = createInternalHealthServer({
    serviceName: config.serviceName,
    host: config.host,
    port: config.port,
    isReady: () => ready,
  });
  const runServer = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/agent/v1/run") {
        send(response, 404, { status: 404, title: "Not Found" });
        return;
      }
      if (!ready || !mcpTokenClient || !answer) {
        send(response, 503, { status: 503, title: "Agent Not Configured" });
        return;
      }
      const bearer = /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/u.exec(
        request.headers.authorization ?? "",
      )?.[1];
      if (!bearer) {
        send(response, 401, { status: 401, title: "Unauthorized" });
        return;
      }
      try {
        const identity = await verifier.verifyAccessToken(new SecretValue(bearer));
        if (
          identity.principalType !== "service" ||
          identity.clientId !== "quantum-agent-gateway" ||
          !identity.audiences.includes("quantum-agent-runtime") ||
          !identity.servicePermissions?.includes("agents:invoke")
        ) {
          send(response, 403, { status: 403, title: "Forbidden" });
          return;
        }
      } catch {
        send(response, 401, { status: 401, title: "Unauthorized" });
        return;
      }
      const parsed = requestSchema.safeParse(await readBody(request));
      if (!parsed.success || parsed.data.tenantId !== config.tenantId) {
        send(response, 400, { status: 400, title: "Invalid Agent Request" });
        return;
      }
      const catalog = catalogFor(parsed.data.question);
      if (!catalog) {
        send(response, 200, {
          answer: noCatalogAnswer(parsed.data.firstTurn),
          sourceIds: [],
          grounded: false,
        });
        return;
      }
      const result = await askCatalog(
        {
          search: createMcpCatalogSearch({
            executionId: parsed.data.executionId,
            tokenClient: mcpTokenClient,
          }),
          answer,
        },
        { catalog, question: parsed.data.question },
      );
      send(response, 200, {
        answer: parsed.data.firstTurn ? `${briefIntroduction}${result.answer}` : result.answer,
        sourceIds: result.sources.map((source) => source.id),
        grounded: result.grounded,
      });
    })().catch(() => {
      if (!response.headersSent) send(response, 503, { status: 503, title: "Agent Unavailable" });
      else response.end();
    });
  });
  runServer.requestTimeout = 45_000;
  runServer.headersTimeout = 10_000;
  try {
    await healthServer.start();
    await new Promise<void>((resolve, reject) => {
      runServer.once("error", reject);
      runServer.listen(config.port + 1, config.host, () => {
        runServer.off("error", reject);
        resolve();
      });
    });
    ready = true;
    registerGracefulShutdown(
      [
        {
          close: () =>
            new Promise<void>((resolve, reject) =>
              runServer.close((error) => (error ? reject(error) : resolve())),
            ),
        },
        healthServer,
      ],
      config.shutdownTimeoutMs,
    );
  } catch {
    await healthServer.close().catch(() => undefined);
    throw new Error("Agent runtime failed to start");
  }
}

void bootstrap().catch(() => {
  process.stderr.write("agent-runtime failed to start\n");
  process.exitCode = 1;
});
