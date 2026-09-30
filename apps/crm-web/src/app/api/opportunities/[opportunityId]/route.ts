import { handleCrmOpportunityUpdate } from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ opportunityId: string }> },
): Promise<Response> {
  const { opportunityId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmOpportunityUpdate(request, runtime, opportunityId),
  );
}
