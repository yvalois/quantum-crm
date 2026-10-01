import { handleCrmDocumentGet, handleCrmDocumentUpdate } from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmDocumentGet(request, runtime, documentId));
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmDocumentUpdate(request, runtime, documentId));
}
