import { describe, expect, it } from "vitest";
import { DashboardLayoutSchema, DashboardPeriodSchema } from "./dashboard.js";

describe("Dashboard reporting contract", () => {
  it("rejects unknown periods and duplicate widget ids", () => {
    expect(DashboardPeriodSchema.safeParse("forever; DROP TABLE contacts").success).toBe(false);
    const widget = {
      id: "018f96c4-3210-7000-8000-000000000001",
      metric: "contacts",
      chart: "number",
      width: "half",
    };
    expect(
      DashboardLayoutSchema.safeParse({ period: "all", widgets: [widget, widget] }).success,
    ).toBe(false);
    expect(
      DashboardLayoutSchema.safeParse({
        period: "all",
        widgets: [{ ...widget, metric: "overdueTasks", chart: "line" }],
      }).success,
    ).toBe(false);
  });
});
