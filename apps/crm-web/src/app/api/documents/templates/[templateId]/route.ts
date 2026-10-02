import { handleCrmDocumentTemplateUpdate } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
): Promise<Response> {
  const { templateId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmDocumentTemplateUpdate(request, runtime, templateId),
  );
}
