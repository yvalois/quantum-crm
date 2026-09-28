import { z } from "zod";

const IdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const NameSchema = z.string().trim().min(1).max(160);
const TaskTitleSchema = z.string().trim().min(1).max(200);
const TaskDescriptionSchema = z.string().trim().min(1).max(4_000);
const TaskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const AutomationStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED"]);
export const AutomationActionSchema = z
  .object({
    type: z.literal("CREATE_TASK"),
    title: TaskTitleSchema,
    description: TaskDescriptionSchema,
    priority: TaskPrioritySchema,
    dueHours: z.number().int().min(1).max(8_760),
  })
  .strict();
export const AutomationSchema = z.object({
  id: IdSchema,
  name: NameSchema,
  status: AutomationStatusSchema,
  triggerEvent: z.literal("CONTACT_MANUAL"),
  action: AutomationActionSchema,
  version: z.string().regex(/^[1-9][0-9]*$/u),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const CreateAutomationSchema = z
  .object({
    name: NameSchema,
    status: AutomationStatusSchema.default("DRAFT"),
    action: AutomationActionSchema,
  })
  .strict();
export const ActivateAutomationSchema = z
  .object({ contactIds: z.array(IdSchema).min(1).max(500) })
  .strict();
export const AutomationExecutionResultSchema = z.object({
  executionId: IdSchema,
  contactId: IdSchema,
  status: z.enum(["SUCCEEDED", "FAILED"]),
  taskId: IdSchema.nullable(),
  errorCode: z.string().nullable(),
});
export const AutomationListResponseSchema = z.object({ data: z.array(AutomationSchema) });
export const AutomationResponseSchema = z.object({ data: AutomationSchema });
export const AutomationActivationResponseSchema = z.object({
  data: z.object({
    automationId: IdSchema,
    operationKey: z.string().min(8).max(128),
    results: z.array(AutomationExecutionResultSchema),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});
export type Automation = z.infer<typeof AutomationSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
export type CreateAutomation = z.infer<typeof CreateAutomationSchema>;
export type ActivateAutomation = z.infer<typeof ActivateAutomationSchema>;
export type AutomationExecutionResult = z.infer<typeof AutomationExecutionResultSchema>;
