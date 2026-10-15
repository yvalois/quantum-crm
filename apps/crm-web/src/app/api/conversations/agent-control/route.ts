import {
  handleCrmAgentControlGet,
  handleCrmAgentControlSet,
} from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmAgentControlGet(request, runtime));
}
export async function PATCH(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmAgentControlSet(request, runtime));
}
