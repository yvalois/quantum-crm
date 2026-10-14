import type { CalendarEvent } from "@quantum-crm/contracts";
import { describe, expect, it } from "vitest";

import {
  calendarDays,
  calendarRange,
  dayEventSegments,
  localDayKey,
  moveCalendar,
} from "./calendar-view-model";

function event(id: string, startsAt: string, endsAt: string): CalendarEvent {
  return { id, startsAt, endsAt } as CalendarEvent;
}

describe("calendar view model", () => {
  it("shows a Monday-first week and an inclusive month grid", () => {
    const anchor = new Date(2026, 9, 14);
    expect(calendarDays(anchor, "week").map(localDayKey)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    const month = calendarDays(anchor, "month");
    expect(localDayKey(month[0]!)).toBe("2026-09-28");
    expect(localDayKey(month[month.length - 1]!)).toBe("2026-11-01");
    expect(month).toHaveLength(35);
  });

  it("queries the exact visible range and navigates months without skipping dates", () => {
    const february = moveCalendar(new Date(2026, 0, 31), "month", 1);
    expect(localDayKey(february)).toBe("2026-02-28");
    const range = calendarRange(february, "month");
    expect(localDayKey(range.from)).toBe("2026-01-26");
    expect(localDayKey(range.to)).toBe("2026-03-02");
  });

  it("clips overnight appointments and places overlapping appointments side by side", () => {
    const day = new Date(2026, 9, 14);
    const segments = dayEventSegments(
      [
        event(
          "overnight",
          new Date(2026, 9, 13, 23, 30).toISOString(),
          new Date(2026, 9, 14, 1, 30).toISOString(),
        ),
        event(
          "first",
          new Date(2026, 9, 14, 9).toISOString(),
          new Date(2026, 9, 14, 10).toISOString(),
        ),
        event(
          "second",
          new Date(2026, 9, 14, 9, 30).toISOString(),
          new Date(2026, 9, 14, 10, 30).toISOString(),
        ),
      ],
      day,
    );
    expect(segments).toHaveLength(3);
    expect(segments.find((entry) => entry.event.id === "overnight")?.startMinute).toBe(0);
    expect(segments.find((entry) => entry.event.id === "first")?.columns).toBe(2);
    expect(segments.find((entry) => entry.event.id === "second")?.column).toBe(1);
  });
});
