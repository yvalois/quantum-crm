import { handleCrmTeamRemoveMember } from "../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly teamId: string; readonly memberId: string }>;
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { teamId, memberId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmTeamRemoveMember(request, runtime, teamId, memberId),
  );
}
