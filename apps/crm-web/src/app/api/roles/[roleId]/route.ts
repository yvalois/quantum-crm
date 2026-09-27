import { handleCrmRoleUpdate } from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ roleId: string }> },
): Promise<Response> {
  const { roleId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmRoleUpdate(request, runtime, roleId));
}
