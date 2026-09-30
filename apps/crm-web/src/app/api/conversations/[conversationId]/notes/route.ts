import { handleCrmConversationNote } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmConversationNote(request, runtime, conversationId));
}
