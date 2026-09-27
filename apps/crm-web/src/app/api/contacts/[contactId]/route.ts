import { handleCrmContactGet, handleCrmContactUpdate } from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ contactId: string }> },
): Promise<Response> {
  const { contactId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmContactGet(request, runtime, contactId));
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ contactId: string }> },
): Promise<Response> {
  const { contactId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmContactUpdate(request, runtime, contactId));
}
