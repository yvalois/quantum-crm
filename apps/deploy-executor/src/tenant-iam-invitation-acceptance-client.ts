import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { tenantOidcIdentity } from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const subjectPattern = /^[!-~]{1,255}$/u;

export class TenantIamInvitationAcceptanceError extends Error {
  public constructor(
    public readonly reason:
      "UNAVAILABLE" | "PERMISSION_DENIED" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT",
  ) {
    super(`IAM invitation acceptance failed: ${reason}`);
    this.name = "TenantIamInvitationAcceptanceError";
  }
}

/**
 * Private profile-local client for the service-only acceptance command. The
 * browser, CRM web session and human members never use this boundary.
 */
export interface TenantIamInvitationAcceptanceClient {
  accept(input: {
    readonly tenantProfileId: string;
    readonly invitationId: string;
    readonly subject: string;
  }): Promise<void>;
}

function secretPath(root: string, tenant: string): string {
  const base = resolve(root);
  const target = resolve(base, tenant, "iam-bootstrap-client-secret");
  if (!target.startsWith(`${base}${sep}`)) {
    throw new TenantIamInvitationAcceptanceError("IDENTITY_MISMATCH");
  }
  return target;
}

export function createTenantIamInvitationAcceptanceClient(options: {
  readonly tenantSecretDirectory: string;
  readonly identityOrigin: string;
}): TenantIamInvitationAcceptanceClient {
  return Object.freeze({
    accept: async (input: Parameters<TenantIamInvitationAcceptanceClient["accept"]>[0]) => {
      if (
        !uuidPattern.test(input.tenantProfileId) ||
        !uuidPattern.test(input.invitationId) ||
        !subjectPattern.test(input.subject)
      ) {
        throw new TenantIamInvitationAcceptanceError("IDENTITY_MISMATCH");
      }

      const identity = tenantOidcIdentity(input.tenantProfileId);
      let secret: string;
      try {
        secret = (
          await readFile(secretPath(options.tenantSecretDirectory, input.tenantProfileId), "utf8")
        ).trim();
      } catch {
        throw new TenantIamInvitationAcceptanceError("UNAVAILABLE");
      }
      if (!secret || /[\0\r\n]/u.test(secret)) {
        throw new TenantIamInvitationAcceptanceError("IDENTITY_MISMATCH");
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
        throw new TenantIamInvitationAcceptanceError("UNAVAILABLE");
      }
      if (tokenResponse.status === 401 || tokenResponse.status === 403) {
        throw new TenantIamInvitationAcceptanceError("PERMISSION_DENIED");
      }
      if (!tokenResponse.ok) throw new TenantIamInvitationAcceptanceError("UNAVAILABLE");
      const tokenPayload: unknown = await tokenResponse.json().catch(() => undefined);
      const accessToken =
        typeof tokenPayload === "object" && tokenPayload !== null
          ? (tokenPayload as { readonly access_token?: unknown }).access_token
          : undefined;
      if (typeof accessToken !== "string" || accessToken.length < 20) {
        throw new TenantIamInvitationAcceptanceError("UNAVAILABLE");
      }

      const alias = `qcrm-${input.tenantProfileId.replaceAll("-", "")}-bootstrap-api`;
      let response: Response;
      try {
        response = await fetch(`http://${alias}:3001/internal/iam/accept-member-invitation`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ invitationId: input.invitationId, oidcSubject: input.subject }),
          signal: AbortSignal.timeout(5_000),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        throw new TenantIamInvitationAcceptanceError("UNAVAILABLE");
      }
      if (response.status === 401 || response.status === 403) {
        throw new TenantIamInvitationAcceptanceError("PERMISSION_DENIED");
      }
      if (response.status === 409) {
        throw new TenantIamInvitationAcceptanceError("TARGET_CONFLICT");
      }
      if (!response.ok) throw new TenantIamInvitationAcceptanceError("UNAVAILABLE");
    },
  });
}
