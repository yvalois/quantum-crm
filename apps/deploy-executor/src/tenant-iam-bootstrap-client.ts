import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { InternalAdministratorAccessResponseSchema } from "@quantum-crm/contracts";
import { tenantOidcIdentity } from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class TenantIamBootstrapError extends Error {
  public constructor(
    public readonly reason:
      "UNAVAILABLE" | "PERMISSION_DENIED" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT",
  ) {
    super(`IAM bootstrap failed: ${reason}`);
  }
}

export interface TenantIamBootstrapClient {
  bootstrap(input: {
    readonly tenantProfileId: string;
    readonly subject: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<void>;
  createAdministrator(input: {
    readonly tenantProfileId: string;
    readonly displayName: string;
    readonly email: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{
    readonly memberId: string;
    readonly subject: string;
    readonly activationUrl: string;
    readonly temporaryPassword: string;
    readonly expiresAt: string;
  }>;
}

function secretPath(root: string, tenant: string): string {
  const base = resolve(root);
  const target = resolve(base, tenant, "iam-bootstrap-client-secret");
  if (!target.startsWith(`${base}${sep}`)) throw new TenantIamBootstrapError("IDENTITY_MISMATCH");
  return target;
}

export function createTenantIamBootstrapClient(options: {
  readonly tenantSecretDirectory: string;
  readonly identityOrigin: string;
}): TenantIamBootstrapClient {
  return Object.freeze({
    bootstrap: async (input: Parameters<TenantIamBootstrapClient["bootstrap"]>[0]) => {
      const { tenantProfileId, subject, idempotencyKey, correlationId } = input;
      if (
        !uuidPattern.test(tenantProfileId) ||
        !/^[!-~]{1,255}$/u.test(subject) ||
        !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey) ||
        !/^[A-Za-z0-9._:-]{1,128}$/u.test(correlationId)
      )
        throw new TenantIamBootstrapError("IDENTITY_MISMATCH");
      const identity = tenantOidcIdentity(tenantProfileId);
      let secret: string;
      try {
        secret = (
          await readFile(secretPath(options.tenantSecretDirectory, tenantProfileId), "utf8")
        ).trim();
      } catch {
        throw new TenantIamBootstrapError("UNAVAILABLE");
      }
      if (!secret || /[\0\r\n]/u.test(secret))
        throw new TenantIamBootstrapError("IDENTITY_MISMATCH");
      const tokenUrl = new URL(
        `/realms/${identity.realmName}/protocol/openid-connect/token`,
        options.identityOrigin,
      );
      const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: identity.bootstrapClientId,
        client_secret: secret,
      });
      let tokenResponse: Response;
      try {
        tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(5_000),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        throw new TenantIamBootstrapError("UNAVAILABLE");
      }
      if (tokenResponse.status === 401 || tokenResponse.status === 403)
        throw new TenantIamBootstrapError("PERMISSION_DENIED");
      if (!tokenResponse.ok) throw new TenantIamBootstrapError("UNAVAILABLE");
      const tokenPayload: unknown = await tokenResponse.json().catch(() => undefined);
      const accessToken =
        typeof tokenPayload === "object" && tokenPayload !== null
          ? (tokenPayload as { access_token?: unknown }).access_token
          : undefined;
      if (typeof accessToken !== "string" || accessToken.length < 20)
        throw new TenantIamBootstrapError("UNAVAILABLE");
      const alias = `qcrm-${tenantProfileId.replaceAll("-", "")}-bootstrap-api`;
      let response: Response;
      try {
        response = await fetch(
          `http://${alias}:3001/internal/iam/bootstrap-initial-administrator`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
              "idempotency-key": idempotencyKey,
              "x-correlation-id": correlationId,
            },
            body: JSON.stringify({ subject }),
            signal: AbortSignal.timeout(5_000),
            cache: "no-store",
            redirect: "error",
          },
        );
      } catch {
        throw new TenantIamBootstrapError("UNAVAILABLE");
      }
      if (response.status === 401 || response.status === 403)
        throw new TenantIamBootstrapError("PERMISSION_DENIED");
      if (response.status === 409) throw new TenantIamBootstrapError("TARGET_CONFLICT");
      if (!response.ok) throw new TenantIamBootstrapError("UNAVAILABLE");
    },
    createAdministrator: async (
      input: Parameters<TenantIamBootstrapClient["createAdministrator"]>[0],
    ) => {
      const { tenantProfileId, displayName, email, idempotencyKey, correlationId } = input;
      if (
        !uuidPattern.test(tenantProfileId) ||
        displayName.trim().length < 1 ||
        displayName.length > 160 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
        !/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey) ||
        !/^[A-Za-z0-9._:-]{1,128}$/u.test(correlationId)
      ) {
        throw new TenantIamBootstrapError("IDENTITY_MISMATCH");
      }
      const identity = tenantOidcIdentity(tenantProfileId);
      let secret: string;
      try {
        secret = (
          await readFile(secretPath(options.tenantSecretDirectory, tenantProfileId), "utf8")
        ).trim();
      } catch {
        throw new TenantIamBootstrapError("UNAVAILABLE");
      }
      if (!secret || /[\0\r\n]/u.test(secret)) {
        throw new TenantIamBootstrapError("IDENTITY_MISMATCH");
      }
      let tokenResponse: Response;
      try {
        tokenResponse = await fetch(
          new URL(
            `/realms/${identity.realmName}/protocol/openid-connect/token`,
            options.identityOrigin,
          ),
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "client_credentials",
              client_id: identity.bootstrapClientId,
              client_secret: secret,
            }),
            signal: AbortSignal.timeout(5_000),
            cache: "no-store",
            redirect: "error",
          },
        );
      } catch {
        throw new TenantIamBootstrapError("UNAVAILABLE");
      }
      if (tokenResponse.status === 401 || tokenResponse.status === 403) {
        throw new TenantIamBootstrapError("PERMISSION_DENIED");
      }
      if (!tokenResponse.ok) throw new TenantIamBootstrapError("UNAVAILABLE");
      const tokenPayload: unknown = await tokenResponse.json().catch(() => undefined);
      const accessToken =
        typeof tokenPayload === "object" && tokenPayload !== null
          ? (tokenPayload as { readonly access_token?: unknown }).access_token
          : undefined;
      if (typeof accessToken !== "string" || accessToken.length < 20) {
        throw new TenantIamBootstrapError("UNAVAILABLE");
      }
      const alias = `qcrm-${tenantProfileId.replaceAll("-", "")}-bootstrap-api`;
      let response: Response;
      try {
        response = await fetch(`http://${alias}:3001/internal/iam/administrators`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "x-correlation-id": correlationId,
          },
          body: JSON.stringify({ displayName, email }),
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        throw new TenantIamBootstrapError("UNAVAILABLE");
      }
      if (response.status === 401 || response.status === 403) {
        throw new TenantIamBootstrapError("PERMISSION_DENIED");
      }
      if (response.status === 409) throw new TenantIamBootstrapError("TARGET_CONFLICT");
      if (!response.ok) throw new TenantIamBootstrapError("UNAVAILABLE");
      const parsed = InternalAdministratorAccessResponseSchema.safeParse(
        await response.json().catch(() => undefined),
      );
      if (!parsed.success) throw new TenantIamBootstrapError("UNAVAILABLE");
      return Object.freeze(parsed.data.data);
    },
  });
}
