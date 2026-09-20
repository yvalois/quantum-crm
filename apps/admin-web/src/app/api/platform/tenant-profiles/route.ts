import {
  handleTenantProfileCreate,
  handleTenantProfileList,
} from "../../../../server/tenant-profile-http";
import { withPlatformAuthRuntime } from "../../../../server/platform-auth-runtime";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withPlatformAuthRuntime((runtime) => handleTenantProfileList(request, runtime));
}

export function POST(request: Request): Promise<Response> {
  return withPlatformAuthRuntime((runtime) => handleTenantProfileCreate(request, runtime));
}
