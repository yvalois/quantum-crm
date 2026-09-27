import { handleCrmTaskStatus } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmTaskStatus(request, runtime, taskId));
}
