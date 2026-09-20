import { handlePlatformOperatorMe } from "../../../../../server/platform-auth-http.js";
import { withPlatformAuthRuntime } from "../../../../../server/platform-auth-runtime.js";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withPlatformAuthRuntime((runtime) => handlePlatformOperatorMe(request, runtime));
}
