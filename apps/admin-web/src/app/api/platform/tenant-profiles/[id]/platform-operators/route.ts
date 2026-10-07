import {
  handleProfileOperatorCreation,
  handleProfileOperatorList,
} from "../../../../../../server/tenant-profile-http";
import { withPlatformAuthRuntime } from "../../../../../../server/platform-auth-runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return withPlatformAuthRuntime((runtime) => handleProfileOperatorList(request, runtime, id));
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return withPlatformAuthRuntime((runtime) => handleProfileOperatorCreation(request, runtime, id));
}
