import { z } from "zod";

export const DashboardPeriodSchema = z.enum(["7d", "30d", "90d", "all"]);
export type DashboardPeriod = z.infer<typeof DashboardPeriodSchema>;

export const DashboardMetricSchema = z.enum([
  "contacts",
  "conversations",
  "openOpportunities",
  "wonOpportunities",
  "pipelineValue",
  "overdueTasks",
]);
export const DashboardChartSchema = z.enum(["number", "bar", "line", "donut"]);
export const DashboardWidgetSchema = z
  .object({
    id: z.string().uuid(),
    metric: DashboardMetricSchema,
    chart: DashboardChartSchema,
    width: z.enum(["half", "full"]),
  })
  .refine(
    (widget) =>
      widget.chart === "number" ||
      (widget.metric === "contacts" && widget.chart === "line") ||
      ((widget.metric === "conversations" || widget.metric === "openOpportunities") &&
        (widget.chart === "bar" || widget.chart === "donut")),
    "Chart is not available for this metric",
  );
export const DashboardLayoutSchema = z.object({
  period: DashboardPeriodSchema,
  widgets: z
    .array(DashboardWidgetSchema)
    .max(12)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "Widget identifiers must be unique",
    ),
});
export const DashboardPreferenceResponseSchema = z.object({
  data: z.object({
    layout: DashboardLayoutSchema,
    version: z.string(),
    updatedAt: z.string().nullable(),
  }),
});
export const DashboardSnapshotSchema = z.object({
  data: z.object({
    period: DashboardPeriodSchema,
    generatedAt: z.string().datetime(),
    metrics: z.object({
      contacts: z.number().int().nullable(),
      conversations: z.number().int().nullable(),
      openOpportunities: z.number().int().nullable(),
      wonOpportunities: z.number().int().nullable(),
      overdueTasks: z.number().int().nullable(),
      pipelineValue: z
        .array(z.object({ currency: z.string().length(3), amountMinor: z.string() }))
        .nullable(),
    }),
    contactsTrend: z.array(z.object({ label: z.string(), value: z.number().int() })),
    opportunityStages: z.array(z.object({ label: z.string(), value: z.number().int() })),
    conversationChannels: z.array(z.object({ label: z.string(), value: z.number().int() })),
  }),
});
export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;
export type DashboardSnapshot = z.infer<typeof DashboardSnapshotSchema>["data"];
