import { handlePublicFormImageAttach } from "../../../../../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ slug: string; responseId: string; fieldId: string; fileId: string }> }) {
  const { slug, responseId, fieldId, fileId } = await context.params;
  return withCrmAuthRuntime((runtime) => handlePublicFormImageAttach(request, runtime, slug, responseId, fieldId, fileId));
}
