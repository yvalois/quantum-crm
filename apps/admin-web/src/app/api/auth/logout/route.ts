import { handlePlatformLogout } from "../../../../server/platform-auth-http";
import { withPlatformAuthRuntime } from "../../../../server/platform-auth-runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withPlatformAuthRuntime((runtime) => handlePlatformLogout(request, runtime));
}
