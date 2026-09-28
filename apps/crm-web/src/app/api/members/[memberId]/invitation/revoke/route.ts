import { handleCrmMemberInvitationRevocation } from "../../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly memberId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { memberId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmMemberInvitationRevocation(request, runtime, memberId),
  );
}
