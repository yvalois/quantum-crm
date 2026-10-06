import { handleInfrastructureServerList } from "../../../../server/infrastructure-server-http";
import { withPlatformAuthRuntime } from "../../../../server/platform-auth-runtime";

export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return withPlatformAuthRuntime((runtime) => handleInfrastructureServerList(request, runtime));
}
