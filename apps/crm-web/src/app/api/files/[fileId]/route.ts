import { handleCrmFileGet } from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  const { fileId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmFileGet(request, runtime, fileId));
}
