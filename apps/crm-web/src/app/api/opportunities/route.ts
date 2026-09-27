import {
  handleCrmOpportunityCreate,
  handleCrmOpportunityList,
} from "../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../server/crm-auth-runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmOpportunityList(request, runtime));
}
export async function POST(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmOpportunityCreate(request, runtime));
}
