import { handleCrmFormGet, handleCrmFormUpdate } from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ formId: string }> }) {
  const { formId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmFormGet(request, runtime, formId));
}
export async function PATCH(request: Request, context: { params: Promise<{ formId: string }> }) {
  const { formId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmFormUpdate(request, runtime, formId));
}
