import { handleCrmFormResponses } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export async function GET(request: Request, context: { params: Promise<{ formId: string }> }) {
  const { formId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmFormResponses(request, runtime, formId));
}
