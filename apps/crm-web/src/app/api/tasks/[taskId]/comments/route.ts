import {
  handleCrmTaskCommentCreate,
  handleCrmTaskCommentList,
} from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmTaskCommentList(request, runtime, taskId));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmTaskCommentCreate(request, runtime, taskId));
}
