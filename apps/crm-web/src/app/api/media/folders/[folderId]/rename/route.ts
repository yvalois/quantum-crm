import { handleCrmMediaFolderRename } from "../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ folderId: string }> },
): Promise<Response> {
  const { folderId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmMediaFolderRename(request, runtime, folderId));
}
