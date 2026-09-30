import {
  handleCrmConversationGet,
  handleCrmConversationUpdate,
} from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmConversationGet(request, runtime, conversationId));
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmConversationUpdate(request, runtime, conversationId));
}
