import {
  handlePublicCalendarAvailability,
  handlePublicCalendarBooking,
} from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  return withCrmAuthRuntime((runtime) => handlePublicCalendarAvailability(request, runtime, slug));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  return withCrmAuthRuntime((runtime) => handlePublicCalendarBooking(request, runtime, slug));
}
