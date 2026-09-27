import { tenantOidcIdentity } from "@quantum-crm/platform-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export class TenantInitialAdministratorProvisioningError extends Error {
  public constructor(
    public readonly reason:
      "UNAVAILABLE" | "PERMISSION_DENIED" | "IDENTITY_MISMATCH" | "TARGET_CONFLICT",
  ) {
    super(`Initial administrator provisioning failed: ${reason}`);
    this.name = "TenantInitialAdministratorProvisioningError";
  }
}

export interface InitialAdministratorCommand {
  readonly tenantProfileId: string;
  readonly email: string;
  readonly displayName: string;
}

export interface ActivationLinkCommand {
  readonly tenantProfileId: string;
  readonly administratorSubject: string;
  readonly generation: number;
}

export interface TenantInitialAdministratorProvisioner {
  readonly reconcile: (
    command: InitialAdministratorCommand,
  ) => Promise<{ readonly subject: string }>;
  /** The return value is deliberately ephemeral: callers must not persist or log it. */
  readonly issueActivation: (
    command: ActivationLinkCommand,
  ) => Promise<{ readonly url: string; readonly expiresAt: string }>;
  readonly activationStatus: (command: ActivationLinkCommand) => Promise<"PENDING" | "CONSUMED">;
}

export interface TenantInitialAdministratorProvisionerOptions {
  readonly keycloakAdminOrigin: string;
  readonly keycloakProvisionerClientId: "quantum-provisioner";
  readonly keycloakProvisionerClientSecret: string;
}

function fail(status: number): never {
  if (status === 401 || status === 403)
    throw new TenantInitialAdministratorProvisioningError("PERMISSION_DENIED");
  if (status === 409) throw new TenantInitialAdministratorProvisioningError("TARGET_CONFLICT");
  throw new TenantInitialAdministratorProvisioningError("UNAVAILABLE");
}

async function token(options: TenantInitialAdministratorProvisionerOptions): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: options.keycloakProvisionerClientId,
    client_secret: options.keycloakProvisionerClientSecret,
  });
  const response = await fetch(
    new URL("/realms/master/protocol/openid-connect/token", options.keycloakAdminOrigin),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) fail(response.status);
  const value: unknown = await response.json();
  const accessToken =
    typeof value === "object" && value !== null
      ? (value as { readonly access_token?: unknown }).access_token
      : undefined;
  if (typeof accessToken !== "string" || accessToken.length < 20)
    throw new TenantInitialAdministratorProvisioningError("UNAVAILABLE");
  return accessToken;
}

function valid(command: InitialAdministratorCommand): void {
  if (
    !uuidPattern.test(command.tenantProfileId) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(command.email) ||
    command.displayName.trim().length < 1 ||
    command.displayName.length > 160
  )
    throw new TenantInitialAdministratorProvisioningError("IDENTITY_MISMATCH");
}

interface KeycloakUserRepresentation {
  readonly id?: unknown;
  readonly username?: unknown;
  readonly email?: unknown;
  readonly firstName?: unknown;
  readonly lastName?: unknown;
  readonly enabled?: unknown;
  readonly requiredActions?: unknown;
}

function userIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new TenantInitialAdministratorProvisioningError("UNAVAILABLE");
  return value.map((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as KeycloakUserRepresentation).id !== "string"
    ) {
      throw new TenantInitialAdministratorProvisioningError("UNAVAILABLE");
    }
    return (candidate as KeycloakUserRepresentation).id as string;
  });
}

function isExactInitialAdministrator(
  candidate: unknown,
  command: InitialAdministratorCommand,
): boolean {
  if (typeof candidate !== "object" || candidate === null) return false;
  const user = candidate as KeycloakUserRepresentation;
  if (
    user.username !== command.email ||
    user.email !== command.email ||
    user.firstName !== command.displayName ||
    user.enabled !== true ||
    (user.lastName !== undefined && user.lastName !== null && user.lastName !== "") ||
    !Array.isArray(user.requiredActions)
  ) {
    return false;
  }
  const actions = new Set(user.requiredActions);
  return (
    actions.size === 2 &&
    actions.has("UPDATE_PASSWORD") &&
    actions.has("CONFIGURE_TOTP") &&
    [...actions].every((action) => typeof action === "string")
  );
}

export function createTenantInitialAdministratorProvisioner(
  options: TenantInitialAdministratorProvisionerOptions,
): TenantInitialAdministratorProvisioner {
  const reconcile = async (
    command: InitialAdministratorCommand,
  ): Promise<{ readonly subject: string }> => {
    valid(command);
    const identity = tenantOidcIdentity(command.tenantProfileId);
    const accessToken = await token(options);
    const headers = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
    const usersUrl = new URL(
      `/admin/realms/${encodeURIComponent(identity.realmName)}/users`,
      options.keycloakAdminOrigin,
    );
    const reconcileExisting = async (): Promise<string | null> => {
      const byEmail = new URL(usersUrl);
      byEmail.searchParams.set("email", command.email);
      byEmail.searchParams.set("exact", "true");
      const byUsername = new URL(usersUrl);
      byUsername.searchParams.set("username", command.email);
      byUsername.searchParams.set("exact", "true");
      const [emailResponse, usernameResponse] = await Promise.all([
        fetch(byEmail, { headers, signal: AbortSignal.timeout(5_000) }),
        fetch(byUsername, { headers, signal: AbortSignal.timeout(5_000) }),
      ]);
      if (!emailResponse.ok) fail(emailResponse.status);
      if (!usernameResponse.ok) fail(usernameResponse.status);
      const [emailSubjects, usernameSubjects] = await Promise.all([
        emailResponse.json().then(userIds),
        usernameResponse.json().then(userIds),
      ]);
      if (emailSubjects.length === 0 && usernameSubjects.length === 0) return null;
      if (
        emailSubjects.length !== 1 ||
        usernameSubjects.length !== 1 ||
        emailSubjects[0] !== usernameSubjects[0]
      ) {
        throw new TenantInitialAdministratorProvisioningError("TARGET_CONFLICT");
      }
      const subject = emailSubjects[0] as string;
      const existing = await fetch(
        new URL(
          `/admin/realms/${encodeURIComponent(identity.realmName)}/users/${encodeURIComponent(subject)}`,
          options.keycloakAdminOrigin,
        ),
        { headers, signal: AbortSignal.timeout(5_000) },
      );
      if (!existing.ok) fail(existing.status);
      if (!isExactInitialAdministrator(await existing.json(), command)) {
        throw new TenantInitialAdministratorProvisioningError("TARGET_CONFLICT");
      }
      return subject;
    };
    let subject = await reconcileExisting();
    if (!subject) {
      const created = await fetch(usersUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          username: command.email,
          email: command.email,
          firstName: command.displayName,
          enabled: true,
          emailVerified: false,
          requiredActions: ["UPDATE_PASSWORD", "CONFIGURE_TOTP"],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (created.status === 409) {
        subject = await reconcileExisting();
        if (!subject) throw new TenantInitialAdministratorProvisioningError("TARGET_CONFLICT");
      } else {
        if (created.status !== 201) fail(created.status);
        const location = created.headers.get("location");
        const matched = location ? /\/users\/([0-9a-f-]{36})$/u.exec(location) : null;
        if (!matched?.[1]) throw new TenantInitialAdministratorProvisioningError("UNAVAILABLE");
        subject = matched[1];
      }
    }
    return Object.freeze({ subject });
  };

  const issueActivation = async (
    command: ActivationLinkCommand,
  ): Promise<{ readonly url: string; readonly expiresAt: string }> => {
    if (
      !uuidPattern.test(command.tenantProfileId) ||
      !uuidPattern.test(command.administratorSubject) ||
      !Number.isInteger(command.generation) ||
      command.generation < 1
    )
      throw new TenantInitialAdministratorProvisioningError("IDENTITY_MISMATCH");
    const accessToken = await token(options);
    const response = await fetch(
      new URL("/realms/master/qcrm-internal/activation", options.keycloakAdminOrigin),
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!response.ok) fail(response.status);
    const value: unknown = await response.json();
    const payload =
      typeof value === "object" && value !== null
        ? (value as { readonly url?: unknown; readonly expiresAt?: unknown })
        : undefined;
    if (
      !payload ||
      typeof payload.url !== "string" ||
      !payload.url.startsWith("https://") ||
      typeof payload.expiresAt !== "string"
    )
      throw new TenantInitialAdministratorProvisioningError("UNAVAILABLE");
    return Object.freeze({ url: payload.url, expiresAt: payload.expiresAt });
  };
  const activationStatus = async (
    command: ActivationLinkCommand,
  ): Promise<"PENDING" | "CONSUMED"> => {
    if (
      !uuidPattern.test(command.tenantProfileId) ||
      !uuidPattern.test(command.administratorSubject) ||
      !Number.isInteger(command.generation) ||
      command.generation < 1
    )
      throw new TenantInitialAdministratorProvisioningError("IDENTITY_MISMATCH");
    const accessToken = await token(options);
    const url = new URL(
      "/realms/master/qcrm-internal/activation/status",
      options.keycloakAdminOrigin,
    );
    url.searchParams.set("tenantProfileId", command.tenantProfileId);
    url.searchParams.set("administratorSubject", command.administratorSubject);
    url.searchParams.set("generation", command.generation.toString());
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) fail(response.status);
    const value: unknown = await response.json();
    const status =
      typeof value === "object" && value !== null
        ? (value as { readonly status?: unknown }).status
        : undefined;
    if (status === "pending") return "PENDING";
    if (status === "consumed") return "CONSUMED";
    throw new TenantInitialAdministratorProvisioningError("UNAVAILABLE");
  };
  return Object.freeze({ reconcile, issueActivation, activationStatus });
}
