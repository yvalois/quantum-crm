import { handlePublicFormImageIntent } from "../../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ slug: string; responseId: string }> }) {
  const { slug, responseId } = await context.params;
  return withCrmAuthRuntime((runtime) => handlePublicFormImageIntent(request, runtime, slug, responseId));
}
