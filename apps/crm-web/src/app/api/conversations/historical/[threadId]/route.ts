import { handleCrmHistoricalConversationGet } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const { threadId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmHistoricalConversationGet(request, runtime, threadId),
  );
}
