import { z } from "zod";

const IdSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(160);
const DescriptionSchema = z.string().trim().min(1).max(2_000);
const AmountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/u);
const TimestampSchema = z.string().datetime({ offset: true });

export const PipelineStageSchema = z.object({ id: IdSchema, name: TextSchema, description: DescriptionSchema, position: z.number().int().min(0) });
export const PipelineSchema = z.object({ id: IdSchema, name: TextSchema, description: DescriptionSchema, stages: z.array(PipelineStageSchema), createdAt: TimestampSchema });
export const OpportunitySchema = z.object({
  id: IdSchema, contactId: IdSchema, pipelineId: IdSchema, stageId: IdSchema,
  title: TextSchema, amountMinor: AmountSchema, currency: CurrencySchema, version: z.string().regex(/^[1-9][0-9]*$/u), createdAt: TimestampSchema, updatedAt: TimestampSchema,
});
export const CreatePipelineSchema = z.object({ name: TextSchema, description: DescriptionSchema }).strict();
export const CreatePipelineStageSchema = z.object({ name: TextSchema, description: DescriptionSchema, position: z.number().int().min(0).max(1000) }).strict();
export const CreateOpportunitySchema = z.object({ contactId: IdSchema, pipelineId: IdSchema, stageId: IdSchema, title: TextSchema, amountMinor: AmountSchema, currency: CurrencySchema }).strict();
export const MoveOpportunitySchema = z.object({ stageId: IdSchema }).strict();
export const PipelineResponseSchema = z.object({ data: PipelineSchema });
export const PipelineListResponseSchema = z.object({ data: z.array(PipelineSchema) });
export const OpportunityResponseSchema = z.object({ data: OpportunitySchema });
export const OpportunityListResponseSchema = z.object({ data: z.array(OpportunitySchema) });
export type Pipeline = z.infer<typeof PipelineSchema>;
export type PipelineStage = z.infer<typeof PipelineStageSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;
