import { handleCrmCalendarAvailabilityReplace } from "../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ calendarId: string }> },
): Promise<Response> {
  const { calendarId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmCalendarAvailabilityReplace(request, runtime, calendarId),
  );
}
