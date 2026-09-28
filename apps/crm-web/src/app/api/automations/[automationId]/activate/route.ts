import { handleCrmAutomationActivate } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ automationId: string }> },
): Promise<Response> {
  const { automationId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmAutomationActivate(request, runtime, automationId),
  );
}
