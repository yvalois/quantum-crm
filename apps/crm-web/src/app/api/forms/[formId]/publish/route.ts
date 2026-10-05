import { handleCrmFormPublish } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export async function POST(request: Request, context: { params: Promise<{ formId: string }> }) {
  const { formId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmFormPublish(request, runtime, formId));
}
