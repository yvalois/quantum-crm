import {
  type PlatformWebAuthService,
  type PlatformWebSession,
  validateCsrf,
  validateRequestOrigin,
} from "@quantum-crm/auth";
import { type CrmWebAuthConfig, SecretValue } from "@quantum-crm/config";
import {
  CreateMemberInvitationSchema,
  ContactIdSchema,
  ContactImportApplyResponseSchema,
  ContactImportFileSchema,
  ContactImportPreviewResponseSchema,
  ContactListQuerySchema,
  ContactListResponseSchema,
  ContactResponseSchema,
  CreateContactSchema,
  CreateOpportunitySchema,
  CreatePipelineSchema,
  CreatePipelineStageSchema,
  InvitationResponseSchema,
  MemberIdSchema,
  MemberListQuerySchema,
  MemberListResponseSchema,
  MemberResponseSchema,
  UpdateMemberSchema,
  CreateRoleSchema,
  RoleListResponseSchema,
  RoleResponseSchema,
  RoleIdSchema,
  UpdateRoleSchema,
  AddTeamMemberSchema,
  CreateTeamSchema,
  TeamIdSchema,
  TeamListResponseSchema,
  TeamResponseSchema,
  UpdateContactSchema,
  MoveOpportunitySchema,
  OpportunityListResponseSchema,
  OpportunityResponseSchema,
  PipelineListResponseSchema,
  PipelineResponseSchema,
  CreateTaskSchema,
  TaskAssigneeListResponseSchema,
  TaskListResponseSchema,
  TaskResponseSchema,
  UpdateTaskStatusSchema,
  ActivateAutomationSchema,
  AutomationActivationResponseSchema,
  AutomationListResponseSchema,
  AutomationResponseSchema,
  CreateAutomationSchema,
} from "@quantum-crm/contracts";

const maximumResponseBytes = 1_048_576;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface CrmAuthRuntime {
  readonly config: CrmWebAuthConfig;
  readonly auth: Pick<
    PlatformWebAuthService,
    "beginLogin" | "completeLogin" | "logout" | "session"
  >;
  readonly crmApiFetch: typeof fetch;
}

async function commercialResponse(
  upstream: Response,
  responseSchema: { parse(input: unknown): unknown },
): Promise<Response> {
  try {
    if (upstream.status === 400) return crmProblem(400, "Invalid request");
    if (upstream.status === 401) return crmProblem(401, "Unauthorized");
    if (upstream.status === 403) return crmProblem(403, "Forbidden");
    if (upstream.status === 404) return crmProblem(404, "Not found");
    if (upstream.status === 409) return crmProblem(409, "Request conflict");
    if (upstream.status === 412) return crmProblem(412, "Resource has changed");
    if (upstream.status === 428) return crmProblem(428, "Version precondition required");
    if (!upstream.ok) return crmProblem(503, "CRM service temporarily unavailable");
    return Response.json(responseSchema.parse(await readBoundedJson(upstream)), {
      headers: crmNoStoreHeaders(),
    });
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmContactList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const query = contactListQuery(request);
  if (!query) return crmProblem(400, "Invalid request");
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const endpoint = new URL("/api/v1/contacts", runtime.config.crmApiOrigin);
    endpoint.search = query.toString();
    const upstream = await runtime.crmApiFetch(endpoint, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authorized.session.accessToken.expose()}`,
        "x-correlation-id": authorized.correlationId,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    return commercialResponse(upstream, ContactListResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmContactCreate(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = CreateContactSchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/contacts", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, ContactResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}

export async function handleCrmContactGet(
  request: Request,
  runtime: CrmAuthRuntime,
  contactId: string,
): Promise<Response> {
  const parsed = ContactIdSchema.safeParse(contactId);
  if (!parsed.success) return crmProblem(400, "Invalid request");
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/contacts/${parsed.data}`, runtime.config.crmApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorized.session.accessToken.expose()}`,
          "x-correlation-id": authorized.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, ContactResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmContactUpdate(
  request: Request,
  runtime: CrmAuthRuntime,
  contactId: string,
): Promise<Response> {
  const parsed = ContactIdSchema.safeParse(contactId);
  const ifMatch = request.headers.get("if-match");
  if (!parsed.success || !ifMatch) return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = UpdateContactSchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const headers = memberMutationHeaders(authorized);
    headers.set("if-match", ifMatch);
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/contacts/${parsed.data}`, runtime.config.crmApiOrigin),
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, ContactResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}

const maximumImportRequestBytes = 8_000_000;

export async function handleCrmContactImportPreview(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  let input: unknown;
  try {
    input = await readBoundedImportRequestJson(request);
  } catch {
    return crmProblem(400, "Invalid request");
  }
  const payload = ContactImportFileSchema.safeParse(input);
  if (!payload.success) return crmProblem(400, "Invalid request");
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/contacts/import/preview", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      },
    );
    return memberMutationResponse(upstream, ContactImportPreviewResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmContactImport(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  let input: unknown;
  try {
    input = await readBoundedImportRequestJson(request);
  } catch {
    return crmProblem(400, "Invalid request");
  }
  const payload = ContactImportFileSchema.safeParse(input);
  if (!payload.success) return crmProblem(400, "Invalid request");
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/contacts/import", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      },
    );
    return memberMutationResponse(upstream, ContactImportApplyResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmContactExport(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const query = contactListQuery(request);
  if (!query) return crmProblem(400, "Invalid request");
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const endpoint = new URL("/api/v1/contacts/export", runtime.config.crmApiOrigin);
    endpoint.search = query.toString();
    const upstream = await runtime.crmApiFetch(endpoint, {
      headers: {
        accept: "text/csv",
        authorization: `Bearer ${authorized.session.accessToken.expose()}`,
        "x-correlation-id": authorized.correlationId,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.status === 401) return crmProblem(401, "Unauthorized");
    if (upstream.status === 403) return crmProblem(403, "Forbidden");
    if (!upstream.ok) return crmProblem(503, "CRM service temporarily unavailable");
    const body = await upstream.text();
    if (new TextEncoder().encode(body).byteLength > maximumResponseBytes) {
      return crmProblem(503, "CRM service temporarily unavailable");
    }
    const headers = crmNoStoreHeaders();
    headers.set("content-type", "text/csv; charset=utf-8");
    headers.set("content-disposition", 'attachment; filename="contacts.csv"');
    return new Response(body, { status: 200, headers });
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmAutomationList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/automations", runtime.config.crmApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorized.session.accessToken.expose()}`,
          "x-correlation-id": authorized.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, AutomationListResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmAutomationCreate(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = CreateAutomationSchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/automations", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, AutomationResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}

export async function handleCrmAutomationActivate(
  request: Request,
  runtime: CrmAuthRuntime,
  automationId: string,
): Promise<Response> {
  if (!uuidPattern.test(automationId)) return crmProblem(400, "Invalid request");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = ActivateAutomationSchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/automations/${automationId}/activate`, runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      },
    );
    return commercialResponse(upstream, AutomationActivationResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}

export async function handleCrmPipelineList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/sales/pipelines", runtime.config.crmApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorized.session.accessToken.expose()}`,
          "x-correlation-id": authorized.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, PipelineListResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}
export async function handleCrmPipelineCreate(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = CreatePipelineSchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/sales/pipelines", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, PipelineResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}
export async function handleCrmPipelineStageCreate(
  request: Request,
  runtime: CrmAuthRuntime,
  pipelineId: string,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (
    !ContactIdSchema.safeParse(pipelineId).success ||
    !idempotencyKey ||
    !idempotencyKeyPattern.test(idempotencyKey)
  )
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = CreatePipelineStageSchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/sales/pipelines/${pipelineId}/stages`, runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, { parse: (value: unknown) => value });
  } catch {
    return crmProblem(400, "Invalid request");
  }
}
export async function handleCrmOpportunityList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/sales/opportunities", runtime.config.crmApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorized.session.accessToken.expose()}`,
          "x-correlation-id": authorized.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, OpportunityListResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}
export async function handleCrmOpportunityCreate(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = CreateOpportunitySchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/sales/opportunities", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, OpportunityResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}
export async function handleCrmOpportunityMove(
  request: Request,
  runtime: CrmAuthRuntime,
  opportunityId: string,
): Promise<Response> {
  if (!ContactIdSchema.safeParse(opportunityId).success) return crmProblem(400, "Invalid request");
  const idempotencyKey = request.headers.get("idempotency-key");
  const ifMatch = request.headers.get("if-match");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey) || !ifMatch)
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = MoveOpportunitySchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const headers = memberMutationHeaders(authorized, idempotencyKey);
    headers.set("if-match", ifMatch);
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/sales/opportunities/${opportunityId}/move`, runtime.config.crmApiOrigin),
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, OpportunityResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}

export async function handleCrmTaskList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/tasks", runtime.config.crmApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorized.session.accessToken.expose()}`,
          "x-correlation-id": authorized.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, TaskListResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}
export async function handleCrmTaskAssigneeList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/tasks/assignees", runtime.config.crmApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorized.session.accessToken.expose()}`,
          "x-correlation-id": authorized.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, TaskAssigneeListResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}
export async function handleCrmTaskCreate(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = CreateTaskSchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/tasks", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, TaskResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}
export async function handleCrmTaskStatus(
  request: Request,
  runtime: CrmAuthRuntime,
  taskId: string,
): Promise<Response> {
  if (!ContactIdSchema.safeParse(taskId).success) return crmProblem(400, "Invalid request");
  const idempotencyKey = request.headers.get("idempotency-key");
  const ifMatch = request.headers.get("if-match");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey) || !ifMatch)
    return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const payload = UpdateTaskStatusSchema.safeParse(await readBoundedRequestJson(request));
    if (!payload.success) return crmProblem(400, "Invalid request");
    const headers = memberMutationHeaders(authorized, idempotencyKey);
    headers.set("if-match", ifMatch);
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/tasks/${taskId}/status`, runtime.config.crmApiOrigin),
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, TaskResponseSchema);
  } catch {
    return crmProblem(400, "Invalid request");
  }
}

export function crmSessionCookieName(config: CrmWebAuthConfig): string {
  return `${config.secureCookies ? "__Host-" : ""}qcrm_crm_session`;
}

function cookieNames(config: CrmWebAuthConfig): {
  readonly login: string;
  readonly session: string;
} {
  const prefix = config.secureCookies ? "__Host-" : "";
  return {
    login: `${prefix}qcrm_crm_login`,
    session: crmSessionCookieName(config),
  };
}

export function crmCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

export function crmNoStoreHeaders(): Headers {
  return new Headers({ "cache-control": "no-store, max-age=0", pragma: "no-cache" });
}

export function crmProblem(status: number, title: string): Response {
  return Response.json(
    { type: "about:blank", title, status },
    {
      status,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/problem+json",
      },
    },
  );
}

function serializeCookie(
  name: string,
  value: string,
  input: { readonly maxAge: number; readonly secure: boolean },
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${input.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(input.secure ? ["Secure"] : []),
  ].join("; ");
}

function redirect(location: string, cookieHeader?: string): Response {
  const headers = crmNoStoreHeaders();
  headers.set("location", location);
  if (cookieHeader) headers.append("set-cookie", cookieHeader);
  return new Response(null, { status: 303, headers });
}

interface AuthorizedCrmSession {
  readonly session: PlatformWebSession;
  readonly correlationId: string;
}

async function authorizedSession(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<AuthorizedCrmSession | Response> {
  const handle = crmCookie(request, crmSessionCookieName(runtime.config));
  if (!handle) return crmProblem(401, "Unauthorized");
  try {
    const session = await runtime.auth.session(new SecretValue(handle));
    if (!session) return crmProblem(401, "Unauthorized");
    return Object.freeze({ session, correlationId: crypto.randomUUID() });
  } catch {
    return crmProblem(503, "Session temporarily unavailable");
  }
}

function isResponse(value: AuthorizedCrmSession | Response): value is Response {
  return value instanceof Response;
}

function memberListQuery(request: Request): URLSearchParams | null {
  const input = new URL(request.url).searchParams;
  const allowed = new Set(["cursor", "limit", "status"]);
  const raw: Record<string, string> = {};
  for (const key of input.keys()) {
    if (!allowed.has(key) || input.getAll(key).length !== 1) return null;
    const value = input.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = MemberListQuerySchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = new URLSearchParams({ limit: parsed.data.limit.toString() });
  if (parsed.data.cursor) output.set("cursor", parsed.data.cursor);
  if (parsed.data.status) output.set("status", parsed.data.status);
  return output;
}

function contactListQuery(request: Request): URLSearchParams | null {
  const input = new URL(request.url).searchParams;
  const allowed = new Set([
    "label",
    "pipelineId",
    "ownerMemberId",
    "channel",
    "createdFrom",
    "createdTo",
  ]);
  const raw: Record<string, string> = {};
  for (const key of input.keys()) {
    if (!allowed.has(key) || input.getAll(key).length !== 1) return null;
    const value = input.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = ContactListQuerySchema.safeParse(raw);
  if (!parsed.success) return null;
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) output.set(key, value);
  }
  return output;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > maximumResponseBytes) {
    throw new Error("Response body is too large");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maximumResponseBytes) {
    throw new Error("Response body is too large");
  }
  return JSON.parse(body) as unknown;
}

async function readBoundedRequestJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") throw new Error("Expected JSON request");
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > maximumResponseBytes) {
    throw new Error("Request body is too large");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumResponseBytes) {
    throw new Error("Request body is too large");
  }
  return JSON.parse(body) as unknown;
}

async function readBoundedImportRequestJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") throw new Error("Expected JSON request");
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > maximumImportRequestBytes) {
    throw new Error("Request body is too large");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumImportRequestBytes) {
    throw new Error("Request body is too large");
  }
  return JSON.parse(body) as unknown;
}

async function authorizedMutation(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<AuthorizedCrmSession | Response> {
  if (!validateRequestOrigin(runtime.config.origin, request.headers.get("origin"))) {
    return crmProblem(403, "Request rejected");
  }
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  if (!validateCsrf(authorized.session.csrfToken, request.headers.get("x-csrf-token"))) {
    return crmProblem(403, "Request rejected");
  }
  return authorized;
}

function memberMutationHeaders(authorized: AuthorizedCrmSession, idempotencyKey?: string): Headers {
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${authorized.session.accessToken.expose()}`,
    "content-type": "application/json",
    "x-correlation-id": authorized.correlationId,
  });
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return headers;
}

async function memberMutationResponse(
  upstream: Response,
  responseSchema: { parse(input: unknown): unknown },
): Promise<Response> {
  try {
    if (upstream.status === 400) return crmProblem(400, "Invalid request");
    if (upstream.status === 401) return crmProblem(401, "Unauthorized");
    if (upstream.status === 403) return crmProblem(403, "Forbidden");
    if (upstream.status === 404) return crmProblem(404, "Not found");
    if (upstream.status === 409) return crmProblem(409, "Request conflict");
    if (!upstream.ok) return crmProblem(503, "CRM service temporarily unavailable");
    return Response.json(responseSchema.parse(await readBoundedJson(upstream)), {
      headers: crmNoStoreHeaders(),
    });
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmLogin(request: Request, runtime: CrmAuthRuntime): Promise<Response> {
  try {
    const started = await runtime.auth.beginLogin(
      new URL(request.url).searchParams.get("returnTo"),
    );
    return redirect(
      started.authorizationUrl.toString(),
      serializeCookie(cookieNames(runtime.config).login, started.transactionHandle.expose(), {
        maxAge: runtime.config.loginTransactionTtlSeconds,
        secure: runtime.config.secureCookies,
      }),
    );
  } catch {
    return crmProblem(503, "Authentication temporarily unavailable");
  }
}

export async function handleCrmCallback(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const names = cookieNames(runtime.config);
  const transactionHandle = crmCookie(request, names.login);
  const clearLogin = serializeCookie(names.login, "", {
    maxAge: 0,
    secure: runtime.config.secureCookies,
  });
  if (!transactionHandle) {
    const response = crmProblem(400, "Invalid authentication response");
    response.headers.append("set-cookie", clearLogin);
    return response;
  }
  try {
    const received = new URL(request.url);
    const callback = new URL(runtime.config.callbackUrl);
    callback.search = received.search;
    const completed = await runtime.auth.completeLogin(
      callback,
      new SecretValue(transactionHandle),
    );
    const headers = crmNoStoreHeaders();
    headers.set("location", new URL(completed.returnTo, runtime.config.origin).toString());
    headers.append("set-cookie", clearLogin);
    headers.append(
      "set-cookie",
      serializeCookie(names.session, completed.sessionHandle.expose(), {
        maxAge: runtime.config.sessionAbsoluteTtlSeconds,
        secure: runtime.config.secureCookies,
      }),
    );
    return new Response(null, { status: 303, headers });
  } catch {
    const response = crmProblem(401, "Authentication failed");
    response.headers.append("set-cookie", clearLogin);
    return response;
  }
}

export async function handleCrmSession(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) {
    if (authorized.status === 401) {
      return Response.json({ authenticated: false }, { status: 401, headers: crmNoStoreHeaders() });
    }
    return authorized;
  }
  return Response.json(
    {
      authenticated: true,
      csrfToken: authorized.session.csrfToken,
      authenticatedAt: authorized.session.authenticatedAt.toISOString(),
    },
    { headers: crmNoStoreHeaders() },
  );
}

export async function handleCrmLogout(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const names = cookieNames(runtime.config);
  const handle = crmCookie(request, names.session);
  if (!handle || !validateRequestOrigin(runtime.config.origin, request.headers.get("origin"))) {
    return crmProblem(403, "Request rejected");
  }
  try {
    const protectedHandle = new SecretValue(handle);
    const session = await runtime.auth.session(protectedHandle);
    if (!session || !validateCsrf(session.csrfToken, request.headers.get("x-csrf-token"))) {
      return crmProblem(403, "Request rejected");
    }
    await runtime.auth.logout(protectedHandle);
    return redirect(
      runtime.config.signedOutUrl,
      serializeCookie(names.session, "", { maxAge: 0, secure: runtime.config.secureCookies }),
    );
  } catch {
    return crmProblem(503, "Session temporarily unavailable");
  }
}

export async function handleCrmMemberList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const query = memberListQuery(request);
  if (!query) return crmProblem(400, "Invalid request");
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const target = new URL("/api/v1/members", runtime.config.crmApiOrigin);
    target.search = query.toString();
    const upstream = await runtime.crmApiFetch(target, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${authorized.session.accessToken.expose()}`,
        "x-correlation-id": authorized.correlationId,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
    if (upstream.status === 401) return crmProblem(401, "Unauthorized");
    if (upstream.status === 403) return crmProblem(403, "Forbidden");
    if (!upstream.ok) return crmProblem(503, "CRM service temporarily unavailable");
    return Response.json(MemberListResponseSchema.parse(await readBoundedJson(upstream)), {
      headers: crmNoStoreHeaders(),
    });
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmMemberInvitation(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey)) {
    return crmProblem(400, "Invalid request");
  }
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  let input: unknown;
  try {
    input = await readBoundedRequestJson(request);
  } catch {
    return crmProblem(400, "Invalid request");
  }
  const payload = CreateMemberInvitationSchema.safeParse(input);
  if (!payload.success) return crmProblem(400, "Invalid request");
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/members/invitations", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized, idempotencyKey),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, InvitationResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmMemberUpdate(
  request: Request,
  runtime: CrmAuthRuntime,
  memberId: string,
): Promise<Response> {
  const parsedMemberId = MemberIdSchema.safeParse(memberId);
  if (!parsedMemberId.success) return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  let input: unknown;
  try {
    input = await readBoundedRequestJson(request);
  } catch {
    return crmProblem(400, "Invalid request");
  }
  const payload = UpdateMemberSchema.safeParse(input);
  if (!payload.success) return crmProblem(400, "Invalid request");
  try {
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/members/${parsedMemberId.data}`, runtime.config.crmApiOrigin),
      {
        method: "PATCH",
        headers: memberMutationHeaders(authorized),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, MemberResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmMemberDeactivation(
  request: Request,
  runtime: CrmAuthRuntime,
  memberId: string,
): Promise<Response> {
  const parsedMemberId = MemberIdSchema.safeParse(memberId);
  if (!parsedMemberId.success) return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/members/${parsedMemberId.data}`, runtime.config.crmApiOrigin),
      {
        method: "DELETE",
        headers: memberMutationHeaders(authorized),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, MemberResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmMemberInvitationRevocation(
  request: Request,
  runtime: CrmAuthRuntime,
  memberId: string,
): Promise<Response> {
  const parsedMemberId = MemberIdSchema.safeParse(memberId);
  if (!parsedMemberId.success) return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL(
        `/api/v1/members/${parsedMemberId.data}/invitation/revoke`,
        runtime.config.crmApiOrigin,
      ),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, InvitationResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmTeamList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/teams", runtime.config.crmApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorized.session.accessToken.expose()}`,
          "x-correlation-id": authorized.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, TeamListResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmTeamCreate(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  let input: unknown;
  try {
    input = await readBoundedRequestJson(request);
  } catch {
    return crmProblem(400, "Invalid request");
  }
  const payload = CreateTeamSchema.safeParse(input);
  if (!payload.success) return crmProblem(400, "Invalid request");
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/teams", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, TeamResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmTeamAddMember(
  request: Request,
  runtime: CrmAuthRuntime,
  teamId: string,
): Promise<Response> {
  const parsedTeamId = TeamIdSchema.safeParse(teamId);
  if (!parsedTeamId.success) return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  let input: unknown;
  try {
    input = await readBoundedRequestJson(request);
  } catch {
    return crmProblem(400, "Invalid request");
  }
  const payload = AddTeamMemberSchema.safeParse(input);
  if (!payload.success) return crmProblem(400, "Invalid request");
  try {
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/teams/${parsedTeamId.data}/members`, runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, TeamResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmTeamRemoveMember(
  request: Request,
  runtime: CrmAuthRuntime,
  teamId: string,
  memberId: string,
): Promise<Response> {
  const parsedTeamId = TeamIdSchema.safeParse(teamId);
  const parsedMemberId = TeamIdSchema.safeParse(memberId);
  if (!parsedTeamId.success || !parsedMemberId.success) return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL(
        `/api/v1/teams/${parsedTeamId.data}/members/${parsedMemberId.data}`,
        runtime.config.crmApiOrigin,
      ),
      {
        method: "DELETE",
        headers: memberMutationHeaders(authorized),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, TeamResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmRoleList(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedSession(request, runtime);
  if (isResponse(authorized)) return authorized;
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/roles", runtime.config.crmApiOrigin),
      {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${authorized.session.accessToken.expose()}`,
          "x-correlation-id": authorized.correlationId,
        },
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return commercialResponse(upstream, RoleListResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmRoleCreate(
  request: Request,
  runtime: CrmAuthRuntime,
): Promise<Response> {
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  let input: unknown;
  try {
    input = await readBoundedRequestJson(request);
  } catch {
    return crmProblem(400, "Invalid request");
  }
  const payload = CreateRoleSchema.safeParse(input);
  if (!payload.success) return crmProblem(400, "Invalid request");
  try {
    const upstream = await runtime.crmApiFetch(
      new URL("/api/v1/roles", runtime.config.crmApiOrigin),
      {
        method: "POST",
        headers: memberMutationHeaders(authorized),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, RoleResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}

export async function handleCrmRoleUpdate(
  request: Request,
  runtime: CrmAuthRuntime,
  roleId: string,
): Promise<Response> {
  const parsedRoleId = RoleIdSchema.safeParse(roleId);
  if (!parsedRoleId.success) return crmProblem(400, "Invalid request");
  const authorized = await authorizedMutation(request, runtime);
  if (isResponse(authorized)) return authorized;
  let input: unknown;
  try {
    input = await readBoundedRequestJson(request);
  } catch {
    return crmProblem(400, "Invalid request");
  }
  const payload = UpdateRoleSchema.safeParse(input);
  if (!payload.success) return crmProblem(400, "Invalid request");
  try {
    const upstream = await runtime.crmApiFetch(
      new URL(`/api/v1/roles/${parsedRoleId.data}`, runtime.config.crmApiOrigin),
      {
        method: "PATCH",
        headers: memberMutationHeaders(authorized),
        body: JSON.stringify(payload.data),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      },
    );
    return memberMutationResponse(upstream, RoleResponseSchema);
  } catch {
    return crmProblem(503, "CRM service temporarily unavailable");
  }
}
