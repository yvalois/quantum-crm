import {
  handleCrmDashboardPreferences,
  handleCrmDashboardPreferencesSave,
} from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmDashboardPreferences(request, runtime));
}
export async function PUT(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmDashboardPreferencesSave(request, runtime));
}
