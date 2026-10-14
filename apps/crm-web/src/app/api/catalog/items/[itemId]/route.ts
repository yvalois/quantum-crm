import { handleCrmCatalogItem, handleCrmCatalogUpdate } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ itemId: string }> }): Promise<Response> {
  const { itemId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmCatalogItem(request, runtime, itemId));
}
export async function PATCH(request: Request, context: { params: Promise<{ itemId: string }> }): Promise<Response> {
  const { itemId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmCatalogUpdate(request, runtime, itemId));
}
