import { handlePlatformOperatorMe } from "../../../../../server/platform-auth-http";
import { withPlatformAuthRuntime } from "../../../../../server/platform-auth-runtime";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withPlatformAuthRuntime((runtime) => handlePlatformOperatorMe(request, runtime));
}
