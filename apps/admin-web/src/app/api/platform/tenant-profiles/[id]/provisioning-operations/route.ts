import { handleTenantProvisioningRequest } from "../../../../../../server/tenant-profile-http";
import { withPlatformAuthRuntime } from "../../../../../../server/platform-auth-runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return withPlatformAuthRuntime((runtime) =>
    handleTenantProvisioningRequest(request, runtime, id),
  );
}
