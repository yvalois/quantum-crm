import { z } from "zod";

const IdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const TitleSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().min(1).max(4_000);
export const TaskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const TaskStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);
/** `EXPIRED` is derived while reading; a caller can never persist it. */
export const MutableTaskStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
export const TaskSchema = z.object({
  id: IdSchema,
  contactId: IdSchema.nullable(),
  opportunityId: IdSchema.nullable(),
  assigneeMemberId: IdSchema,
  title: TitleSchema,
  description: DescriptionSchema,
  priority: TaskPrioritySchema,
  dueAt: TimestampSchema.nullable(),
  status: TaskStatusSchema,
  version: z.string().regex(/^[1-9][0-9]*$/u),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export const CreateTaskSchema = z
  .object({
    contactId: IdSchema.optional(),
    opportunityId: IdSchema.optional(),
    assigneeMemberId: IdSchema,
    title: TitleSchema,
    description: DescriptionSchema,
    priority: TaskPrioritySchema.default("MEDIUM"),
    dueAt: TimestampSchema,
  })
  .strict()
  .refine(
    (value) => (value.contactId !== undefined) !== (value.opportunityId !== undefined),
    "A task requires exactly one commercial relation",
  );
export const UpdateTaskStatusSchema = z.object({ status: MutableTaskStatusSchema }).strict();
export const TaskResponseSchema = z.object({ data: TaskSchema });
export const TaskListResponseSchema = z.object({ data: z.array(TaskSchema) });
export const TaskAssigneeSchema = z.object({
  id: IdSchema,
  displayName: z.string().trim().min(1).max(160),
});
export const TaskAssigneeListResponseSchema = z.object({ data: z.array(TaskAssigneeSchema) });
export type Task = z.infer<typeof TaskSchema>;
export type TaskAssignee = z.infer<typeof TaskAssigneeSchema>;
export type MutableTaskStatus = z.infer<typeof MutableTaskStatusSchema>;
