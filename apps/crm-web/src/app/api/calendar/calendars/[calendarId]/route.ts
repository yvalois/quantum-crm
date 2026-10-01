import {
  handleCrmCalendarConfiguration,
  handleCrmCalendarUpdate,
} from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ calendarId: string }> },
): Promise<Response> {
  const { calendarId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmCalendarConfiguration(request, runtime, calendarId),
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ calendarId: string }> },
): Promise<Response> {
  const { calendarId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmCalendarUpdate(request, runtime, calendarId));
}
