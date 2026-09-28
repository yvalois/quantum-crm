const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const subjectPattern = /^[!-~]{1,255}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export class MemberActivationIssuerError extends Error {
  public constructor(
    public readonly reason: "UNAVAILABLE" | "PERMISSION_DENIED" | "TARGET_CONFLICT",
  ) {
    super(`Member activation could not be issued: ${reason}`);
    this.name = "MemberActivationIssuerError";
  }
}

export interface MemberActivationIssuer {
  issue(input: {
    readonly invitationId: string;
    readonly email: string;
    readonly displayName: string;
    readonly generation: number;
  }): Promise<{
    readonly subject: string;
    readonly url: string;
    readonly expiresAt: string;
    readonly generation: number;
  }>;
}

function fail(status: number): never {
  if (status === 401 || status === 403) {
    throw new MemberActivationIssuerError("PERMISSION_DENIED");
  }
  if (status === 409) throw new MemberActivationIssuerError("TARGET_CONFLICT");
  throw new MemberActivationIssuerError("UNAVAILABLE");
}

export function createMemberActivationIssuer(options: {
  readonly tenantProfileId: string;
  readonly identityIssuer: string;
  readonly clientId: "quantum-crm-bootstrap";
  readonly clientSecret: string;
}): MemberActivationIssuer {
  const issuer = new URL(options.identityIssuer);
  const tokenUrl = new URL(
    "protocol/openid-connect/token",
    `${issuer.toString().replace(/\/$/u, "/")}`,
  );
  const activationUrl = new URL(
    "qcrm-internal/activation",
    `${issuer.toString().replace(/\/$/u, "/")}`,
  );
  return Object.freeze({
    issue: async (input: Parameters<MemberActivationIssuer["issue"]>[0]) => {
      if (
        !uuidPattern.test(input.invitationId) ||
        !emailPattern.test(input.email) ||
        input.displayName.trim().length < 1 ||
        input.displayName.length > 160 ||
        !Number.isInteger(input.generation) ||
        input.generation < 1
      ) {
        throw new MemberActivationIssuerError("TARGET_CONFLICT");
      }
      let tokenResponse: Response;
      try {
        tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: options.clientId,
            client_secret: options.clientSecret,
          }),
          signal: AbortSignal.timeout(5_000),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        throw new MemberActivationIssuerError("UNAVAILABLE");
      }
      if (!tokenResponse.ok) fail(tokenResponse.status);
      const tokenPayload: unknown = await tokenResponse.json().catch(() => undefined);
      const accessToken =
        typeof tokenPayload === "object" && tokenPayload !== null
          ? (tokenPayload as { readonly access_token?: unknown }).access_token
          : undefined;
      if (typeof accessToken !== "string" || accessToken.length < 20) {
        throw new MemberActivationIssuerError("UNAVAILABLE");
      }
      let response: Response;
      try {
        response = await fetch(activationUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            tenantProfileId: options.tenantProfileId,
            invitationId: input.invitationId,
            email: input.email,
            displayName: input.displayName,
            generation: input.generation,
          }),
          signal: AbortSignal.timeout(5_000),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        throw new MemberActivationIssuerError("UNAVAILABLE");
      }
      if (!response.ok) fail(response.status);
      const value: unknown = await response.json().catch(() => undefined);
      const payload =
        typeof value === "object" && value !== null
          ? (value as {
              readonly subject?: unknown;
              readonly url?: unknown;
              readonly expiresAt?: unknown;
              readonly generation?: unknown;
            })
          : undefined;
      if (
        !payload ||
        typeof payload.subject !== "string" ||
        !subjectPattern.test(payload.subject) ||
        typeof payload.url !== "string" ||
        !payload.url.startsWith("https://") ||
        typeof payload.expiresAt !== "string" ||
        payload.generation !== input.generation
      ) {
        throw new MemberActivationIssuerError("UNAVAILABLE");
      }
      return Object.freeze({
        subject: payload.subject,
        url: payload.url,
        expiresAt: payload.expiresAt,
        generation: input.generation,
      });
    },
  });
}
