import { z } from "zod";

const IdSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(160);
const DescriptionSchema = z.string().trim().min(1).max(2_000);
const AmountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/u);
const TimestampSchema = z.string().datetime({ offset: true });
const OptionalTextSchema = z.string().trim().min(1).max(2_000).nullable();

export const OpportunityStatusSchema = z.enum(["OPEN", "WON", "LOST", "ABANDONED"]);
export const OpportunityHistoryEventSchema = z.enum([
  "CREATED",
  "STAGE_CHANGED",
  "UPDATED",
  "STATUS_CHANGED",
  "OWNER_CHANGED",
]);

export const PipelineStageSchema = z.object({
  id: IdSchema,
  name: TextSchema,
  description: DescriptionSchema,
  position: z.number().int().min(0),
});
export const PipelineSchema = z.object({
  id: IdSchema,
  name: TextSchema,
  description: DescriptionSchema,
  stages: z.array(PipelineStageSchema),
  createdAt: TimestampSchema,
});
export const OpportunitySchema = z.object({
  id: IdSchema,
  ownerMemberId: IdSchema,
  contactId: IdSchema,
  pipelineId: IdSchema,
  stageId: IdSchema,
  title: TextSchema,
  amountMinor: AmountSchema,
  currency: CurrencySchema,
  status: OpportunityStatusSchema,
  closeReason: OptionalTextSchema,
  closedAt: TimestampSchema.nullable(),
  version: z.string().regex(/^[1-9][0-9]*$/u),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const OpportunityHistoryEntrySchema = z.object({
  id: IdSchema,
  opportunityId: IdSchema,
  eventType: OpportunityHistoryEventSchema,
  actorMemberId: IdSchema,
  previousStageId: IdSchema.nullable(),
  nextStageId: IdSchema.nullable(),
  previousOwnerMemberId: IdSchema.nullable(),
  nextOwnerMemberId: IdSchema.nullable(),
  previousStatus: OpportunityStatusSchema.nullable(),
  nextStatus: OpportunityStatusSchema.nullable(),
  previousAmountMinor: AmountSchema.nullable(),
  nextAmountMinor: AmountSchema.nullable(),
  note: OptionalTextSchema,
  createdAt: TimestampSchema,
});
const CreateInitialPipelineStageSchema = z
  .object({ name: TextSchema, description: DescriptionSchema })
  .strict();
export const CreatePipelineSchema = z
  .object({
    name: TextSchema,
    description: DescriptionSchema,
    stages: z.array(CreateInitialPipelineStageSchema).min(1).max(25).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.stages) return;
    const names = new Set<string>();
    for (const [index, stage] of value.stages.entries()) {
      const normalizedName = stage.name.normalize("NFKC").toLowerCase();
      if (names.has(normalizedName)) {
        context.addIssue({
          code: "custom",
          path: ["stages", index, "name"],
          message: "Pipeline stage names must be unique",
        });
      }
      names.add(normalizedName);
    }
  });
export const CreatePipelineStageSchema = z
  .object({
    name: TextSchema,
    description: DescriptionSchema,
    position: z.number().int().min(0).max(1000),
  })
  .strict();
export const CreateOpportunitySchema = z
  .object({
    contactId: IdSchema,
    pipelineId: IdSchema,
    stageId: IdSchema,
    ownerMemberId: IdSchema.optional(),
    title: TextSchema,
    amountMinor: AmountSchema,
    currency: CurrencySchema,
  })
  .strict();
export const MoveOpportunitySchema = z.object({ stageId: IdSchema }).strict();
export const UpdateOpportunitySchema = z
  .object({
    title: TextSchema.optional(),
    amountMinor: AmountSchema.optional(),
    currency: CurrencySchema.optional(),
    ownerMemberId: IdSchema.optional(),
    status: OpportunityStatusSchema.optional(),
    closeReason: OptionalTextSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
export const OpportunityListQuerySchema = z
  .object({
    contactId: IdSchema.optional(),
    pipelineId: IdSchema.optional(),
    stageId: IdSchema.optional(),
    ownerMemberId: IdSchema.optional(),
    status: OpportunityStatusSchema.optional(),
    label: z.string().trim().min(1).max(120).optional(),
    createdFrom: TimestampSchema.optional(),
    createdTo: TimestampSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.createdFrom === undefined ||
      value.createdTo === undefined ||
      Date.parse(value.createdFrom) <= Date.parse(value.createdTo),
    "createdFrom must not be after createdTo",
  );
export const PipelineResponseSchema = z.object({ data: PipelineSchema });
export const PipelineListResponseSchema = z.object({ data: z.array(PipelineSchema) });
export const OpportunityResponseSchema = z.object({ data: OpportunitySchema });
export const OpportunityListResponseSchema = z.object({ data: z.array(OpportunitySchema) });
export const OpportunityHistoryListResponseSchema = z.object({
  data: z.array(OpportunityHistoryEntrySchema),
});
export type Pipeline = z.infer<typeof PipelineSchema>;
export type PipelineStage = z.infer<typeof PipelineStageSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;
export type OpportunityListQuery = z.infer<typeof OpportunityListQuerySchema>;
export type OpportunityHistoryEntry = z.infer<typeof OpportunityHistoryEntrySchema>;
