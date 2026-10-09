import { handlePublicFormImageComplete } from "../../../../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ slug: string; responseId: string; fileId: string }> }) {
  const { slug, responseId, fileId } = await context.params;
  return withCrmAuthRuntime((runtime) => handlePublicFormImageComplete(request, runtime, slug, responseId, fileId));
}
