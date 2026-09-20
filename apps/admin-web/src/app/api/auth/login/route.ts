import { handlePlatformLogin } from "../../../../server/platform-auth-http";
import { withPlatformAuthRuntime } from "../../../../server/platform-auth-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withPlatformAuthRuntime((runtime) => handlePlatformLogin(request, runtime));
}
