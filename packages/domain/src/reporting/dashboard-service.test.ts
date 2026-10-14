import { describe, expect, it, vi } from "vitest";
import { DashboardService, type DashboardRepository } from "./dashboard-service.js";

describe("DashboardService", () => {
  it("derives the date window and data access from verified member permissions", async () => {
    const snapshot = vi.fn().mockResolvedValue({});
    const repository = { snapshot } as unknown as DashboardRepository;
    const service = new DashboardService(repository);
    const now = new Date("2026-10-14T12:00:00.000Z");

    await service.snapshot(
      { memberId: "member-1", scope: "ASSIGNED" },
      ["crm:contacts:read"],
      "7d",
      now,
    );

    expect(snapshot).toHaveBeenCalledWith({
      actor: { memberId: "member-1", scope: "ASSIGNED" },
      from: new Date("2026-10-07T12:00:00.000Z"),
      now,
      period: "7d",
      access: { contacts: true, conversations: false, sales: false, tasks: false },
    });
  });

  it("does not impose a silent window when all history is selected", async () => {
    const snapshot = vi.fn().mockResolvedValue({});
    const service = new DashboardService({ snapshot } as unknown as DashboardRepository);
    await service.snapshot(
      { memberId: "member-1", scope: "PROFILE" },
      [],
      "all",
      new Date("2026-10-14T12:00:00.000Z"),
    );
    expect(snapshot.mock.calls[0]?.[0].from).toBeNull();
  });
});
