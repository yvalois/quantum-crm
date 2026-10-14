import { handleCrmCatalogStock } from "../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  const { itemId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmCatalogStock(request, runtime, itemId));
}
