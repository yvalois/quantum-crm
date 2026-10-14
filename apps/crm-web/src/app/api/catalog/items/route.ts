import { handleCrmCatalogCreate, handleCrmCatalogList } from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmCatalogList(request, runtime));
}
export async function POST(request: Request): Promise<Response> {
  return withCrmAuthRuntime((runtime) => handleCrmCatalogCreate(request, runtime));
}
