import { handleCrmPipelineStageCreate } from "../../../../../server/crm-auth-http";
import { withCrmAuthRuntime } from "../../../../../server/crm-auth-runtime";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ pipelineId: string }> },
): Promise<Response> {
  const { pipelineId } = await context.params;
  return withCrmAuthRuntime((runtime) =>
    handleCrmPipelineStageCreate(request, runtime, pipelineId),
  );
}
