import { handleCrmFormClose } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export async function POST(request: Request, context: { params: Promise<{ formId: string }> }) {
  const { formId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmFormClose(request, runtime, formId));
}
