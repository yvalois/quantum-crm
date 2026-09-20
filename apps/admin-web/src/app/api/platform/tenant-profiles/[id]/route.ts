import {
  handleTenantProfileGet,
  handleTenantProfileUpdate,
} from "../../../../../server/tenant-profile-http";
import { withPlatformAuthRuntime } from "../../../../../server/platform-auth-runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return withPlatformAuthRuntime((runtime) => handleTenantProfileGet(request, runtime, id));
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return withPlatformAuthRuntime((runtime) => handleTenantProfileUpdate(request, runtime, id));
}
