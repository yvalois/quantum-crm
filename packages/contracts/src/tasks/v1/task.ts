import { z } from "zod";

const IdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const TitleSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().trim().min(1).max(4_000);
export const TaskPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const TaskTypeSchema = z.enum([
  "CALL",
  "MESSAGE",
  "MEETING",
  "QUOTE",
  "COLLECTION",
  "OTHER",
]);
export const TaskOriginSchema = z.enum(["MANUAL", "AUTOMATION", "AGENT"]);
export const TaskStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
]);
/** `EXPIRED` is derived while reading; a caller can never persist it. */
export const MutableTaskStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
export const TaskSchema = z
  .object({
    id: IdSchema,
    contactId: IdSchema.nullable(),
    opportunityId: IdSchema.nullable(),
    assigneeMemberId: IdSchema,
    title: TitleSchema,
    description: DescriptionSchema,
    priority: TaskPrioritySchema,
    type: TaskTypeSchema,
    origin: TaskOriginSchema,
    dueAt: TimestampSchema.nullable(),
    status: TaskStatusSchema,
    completedAt: TimestampSchema.nullable(),
    completedByMemberId: IdSchema.nullable(),
    version: z.string().regex(/^[1-9][0-9]*$/u),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .superRefine((task, context) => {
    const closed = task.status === "COMPLETED" || task.status === "CANCELLED";
    const completeMetadata = task.completedAt !== null && task.completedByMemberId !== null;
    const emptyMetadata = task.completedAt === null && task.completedByMemberId === null;
    if ((closed && !completeMetadata) || (!closed && !emptyMetadata)) {
      context.addIssue({
        code: "custom",
        message: "Closure metadata must match the task status",
        path: ["completedAt"],
      });
    }
  });
export const CreateTaskSchema = z
  .object({
    contactId: IdSchema.optional(),
    opportunityId: IdSchema.optional(),
    assigneeMemberId: IdSchema,
    title: TitleSchema,
    description: DescriptionSchema,
    priority: TaskPrioritySchema.default("MEDIUM"),
    type: TaskTypeSchema.default("OTHER"),
    dueAt: TimestampSchema,
  })
  .strict()
  .refine(
    (value) => (value.contactId !== undefined) !== (value.opportunityId !== undefined),
    "A task requires exactly one commercial relation",
  );
export const UpdateTaskStatusSchema = z.object({ status: MutableTaskStatusSchema }).strict();
export const UpdateTaskSchema = z
  .object({
    assigneeMemberId: IdSchema.optional(),
    title: TitleSchema.optional(),
    description: DescriptionSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    type: TaskTypeSchema.optional(),
    dueAt: TimestampSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
export const TaskListQuerySchema = z
  .object({
    contactId: IdSchema.optional(),
    opportunityId: IdSchema.optional(),
    assigneeMemberId: IdSchema.optional(),
    status: TaskStatusSchema.optional(),
    priority: TaskPrioritySchema.optional(),
    type: TaskTypeSchema.optional(),
    dueFrom: TimestampSchema.optional(),
    dueTo: TimestampSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.dueFrom === undefined ||
      value.dueTo === undefined ||
      Date.parse(value.dueFrom) <= Date.parse(value.dueTo),
    "dueFrom must not be after dueTo",
  );
export const TaskCommentSchema = z
  .object({
    id: IdSchema,
    taskId: IdSchema,
    authorMemberId: IdSchema,
    body: z.string().trim().min(1).max(4_000),
    createdAt: TimestampSchema,
  })
  .strict();
export const CreateTaskCommentSchema = z
  .object({ body: z.string().trim().min(1).max(4_000) })
  .strict();
export const TaskHistoryEventSchema = z.enum([
  "CREATED",
  "UPDATED",
  "ASSIGNEE_CHANGED",
  "STATUS_CHANGED",
  "COMMENTED",
]);
export const TaskHistoryEntrySchema = z
  .object({
    id: IdSchema,
    taskId: IdSchema,
    eventType: TaskHistoryEventSchema,
    actorMemberId: IdSchema,
    note: z.string().trim().min(1).max(4_000).nullable(),
    createdAt: TimestampSchema,
  })
  .strict();
export const TaskResponseSchema = z.object({ data: TaskSchema });
export const TaskListResponseSchema = z.object({ data: z.array(TaskSchema) });
export const TaskCommentResponseSchema = z.object({ data: TaskCommentSchema });
export const TaskCommentListResponseSchema = z.object({ data: z.array(TaskCommentSchema) });
export const TaskHistoryListResponseSchema = z.object({ data: z.array(TaskHistoryEntrySchema) });
export const TaskAssigneeSchema = z.object({
  id: IdSchema,
  displayName: z.string().trim().min(1).max(160),
});
export const TaskAssigneeListResponseSchema = z.object({ data: z.array(TaskAssigneeSchema) });
export type Task = z.infer<typeof TaskSchema>;
export type TaskAssignee = z.infer<typeof TaskAssigneeSchema>;
export type MutableTaskStatus = z.infer<typeof MutableTaskStatusSchema>;
export type TaskType = z.infer<typeof TaskTypeSchema>;
export type TaskOrigin = z.infer<typeof TaskOriginSchema>;
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
export type TaskComment = z.infer<typeof TaskCommentSchema>;
export type TaskHistoryEntry = z.infer<typeof TaskHistoryEntrySchema>;
