import { handleCrmFileReferenceCreate } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmFileReferenceCreate(request, runtime, fileId));
}
