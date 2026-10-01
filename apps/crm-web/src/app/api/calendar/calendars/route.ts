import { handleCrmCalendarCreate, handleCrmCalendarList } from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmCalendarList(request, runtime));
}

export async function POST(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmCalendarCreate(request, runtime));
}
