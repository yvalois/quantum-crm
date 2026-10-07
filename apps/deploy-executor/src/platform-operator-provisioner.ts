import { randomBytes } from "node:crypto";

export class PlatformOperatorProvisioningError extends Error {
  public constructor() {
    super("Platform operator provisioning failed");
    this.name = "PlatformOperatorProvisioningError";
  }
}

export interface PlatformOperatorProvisioner {
  readonly provision: (command: {
    readonly assignmentId: string;
    readonly displayName: string;
    readonly email: string;
  }) => Promise<{ readonly subject: string; readonly temporaryPassword: string }>;
}

interface Options {
  readonly keycloakAdminOrigin: string;
  readonly clientId: "quantum-provisioner";
  readonly clientSecret: string;
}

async function accessToken(options: Options): Promise<string> {
  const response = await fetch(
    new URL("/realms/master/protocol/openid-connect/token", options.keycloakAdminOrigin),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: options.clientId,
        client_secret: options.clientSecret,
      }),
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) throw new PlatformOperatorProvisioningError();
  const body: unknown = await response.json();
  const token =
    typeof body === "object" && body !== null
      ? (body as { readonly access_token?: unknown }).access_token
      : undefined;
  if (typeof token !== "string" || token.length < 20) {
    throw new PlatformOperatorProvisioningError();
  }
  return token;
}

interface KeycloakUser {
  readonly id?: unknown;
  readonly username?: unknown;
  readonly email?: unknown;
  readonly attributes?: unknown;
}

function subjectFor(value: unknown, assignmentId: string, email: string): string | null {
  if (!Array.isArray(value)) throw new PlatformOperatorProvisioningError();
  if (value.length === 0) return null;
  if (value.length !== 1 || typeof value[0] !== "object" || value[0] === null) {
    throw new PlatformOperatorProvisioningError();
  }
  const user = value[0] as KeycloakUser;
  const attributes =
    typeof user.attributes === "object" && user.attributes !== null
      ? (user.attributes as Record<string, unknown>)
      : {};
  if (
    typeof user.id !== "string" ||
    user.username !== email ||
    user.email !== email ||
    !Array.isArray(attributes.qcrmProfileOperatorAssignment) ||
    attributes.qcrmProfileOperatorAssignment[0] !== assignmentId
  ) {
    throw new PlatformOperatorProvisioningError();
  }
  return user.id;
}

export function createPlatformOperatorProvisioner(options: Options): PlatformOperatorProvisioner {
  const provision = async (command: {
    readonly assignmentId: string;
    readonly displayName: string;
    readonly email: string;
  }) => {
    const token = await accessToken(options);
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const users = new URL("/admin/realms/quantum-platform/users", options.keycloakAdminOrigin);
    const lookup = new URL(users);
    lookup.searchParams.set("email", command.email);
    lookup.searchParams.set("exact", "true");
    let response = await fetch(lookup, { headers, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new PlatformOperatorProvisioningError();
    let subject = subjectFor(await response.json(), command.assignmentId, command.email);
    if (!subject) {
      response = await fetch(users, {
        method: "POST",
        headers,
        body: JSON.stringify({
          username: command.email,
          email: command.email,
          firstName: command.displayName,
          enabled: true,
          emailVerified: true,
          requiredActions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP"],
          attributes: { qcrmProfileOperatorAssignment: [command.assignmentId] },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status !== 201 && response.status !== 409) {
        throw new PlatformOperatorProvisioningError();
      }
      const retried = await fetch(lookup, { headers, signal: AbortSignal.timeout(5_000) });
      if (!retried.ok) throw new PlatformOperatorProvisioningError();
      subject = subjectFor(await retried.json(), command.assignmentId, command.email);
      if (!subject) throw new PlatformOperatorProvisioningError();
    }
    const temporaryPassword = `Aa9!${randomBytes(18).toString("base64url")}`;
    const reset = await fetch(
      new URL(
        `/admin/realms/quantum-platform/users/${encodeURIComponent(subject)}/reset-password`,
        options.keycloakAdminOrigin,
      ),
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ type: "password", value: temporaryPassword, temporary: true }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (reset.status !== 204) throw new PlatformOperatorProvisioningError();
    return Object.freeze({ subject, temporaryPassword });
  };
  return Object.freeze({ provision });
}
