import { handleCrmTaskHistory } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmTaskHistory(request, runtime, taskId));
}
