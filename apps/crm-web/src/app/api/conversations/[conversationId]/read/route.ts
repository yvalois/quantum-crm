import { handleCrmConversationMarkRead } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function PUT(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmConversationMarkRead(request, runtime, conversationId),
  );
}
