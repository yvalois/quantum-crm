import {
  handleCrmTeamAddMember,
  handleCrmTeamRemoveMember,
} from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly teamId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { teamId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmTeamAddMember(request, runtime, teamId));
}

// DELETE is intentionally unsupported at this collection route; removal uses
// the member-specific route to keep the target explicit.
