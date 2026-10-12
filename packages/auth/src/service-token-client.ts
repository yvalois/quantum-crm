import type { SecretValue } from "@quantum-crm/config";
import { SecretValue as ProtectedToken } from "@quantum-crm/config";
import { z } from "zod";

const tokenResponseSchema = z.object({
  access_token: z.string().min(20).max(16_384),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().min(30).max(900),
});

export interface ServiceTokenClient {
  readonly issue: () => Promise<SecretValue>;
}

/** Keeps provider credentials in the OAuth adapter; tokens never enter agent state. */
export function createServiceTokenClient(options: {
  readonly issuer: string;
  readonly clientId: "quantum-agent-gateway" | "quantum-agent-runtime";
  readonly clientSecret: SecretValue;
  readonly fetcher?: typeof fetch;
}): ServiceTokenClient {
  const issuer = new URL(options.issuer);
  if (
    issuer.protocol !== "https:" ||
    issuer.search ||
    issuer.hash ||
    issuer.username ||
    issuer.password
  )
    throw new Error("Invalid service issuer");
  const tokenUrl = new URL(
    `${issuer.pathname.replace(/\/$/u, "")}/protocol/openid-connect/token`,
    issuer.origin,
  );
  return Object.freeze({
    issue: async () => {
      const response = await (options.fetcher ?? fetch)(tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: options.clientId,
          client_secret: options.clientSecret.expose(),
        }),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Service token request failed");
      const token = tokenResponseSchema.parse(await response.json());
      return new ProtectedToken(token.access_token);
    },
  });
}
