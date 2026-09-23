import {
  handleCrmMemberDeactivation,
  handleCrmMemberUpdate,
} from "../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../server/crm-auth-runtime";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly memberId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { memberId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmMemberUpdate(request, runtime, memberId));
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { memberId } = await context.params;
  return withCrmAuthRuntime((runtime) => handleCrmMemberDeactivation(request, runtime, memberId));
}
