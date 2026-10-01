import { handleCrmCalendarEventStatus } from "../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const { eventId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmCalendarEventStatus(request, runtime, eventId));
}
