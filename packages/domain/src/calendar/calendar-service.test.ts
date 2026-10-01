import { describe, expect, it } from "vitest";

import { calculateAvailableSlots } from "./calendar-service.js";
import type { CalendarSchedulingSnapshot } from "./index.js";

const calendarId = "019b0000-0000-7000-8000-000000000101";
const advisorMemberId = "019b0000-0000-7000-8000-000000000102";

function snapshot(): CalendarSchedulingSnapshot {
  return {
    calendar: {
      id: calendarId,
      name: "Ventas",
      serviceName: "Diagnóstico",
      location: null,
      timeZone: "America/Bogota",
      slotDurationMinutes: 30,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 10,
      bookingSlug: "ventas-12345678",
      active: true,
      version: 1n,
      createdAt: new Date("2026-10-01T12:00:00Z"),
      updatedAt: new Date("2026-10-01T12:00:00Z"),
    },
    rules: [
      {
        id: "019b0000-0000-7000-8000-000000000104",
        calendarId,
        advisorMemberId,
        weekday: 1,
        startMinute: 540,
        endMinute: 720,
      },
    ],
    exceptions: [],
    busyEvents: [],
  };
}

describe("calendar availability", () => {
  it("generates slots in the configured IANA zone", () => {
    const slots = calculateAvailableSlots({
      snapshot: snapshot(),
      from: new Date("2026-10-05T13:00:00Z"),
      to: new Date("2026-10-05T18:00:00Z"),
    });

    expect(slots).toHaveLength(6);
    expect(slots[0]).toMatchObject({
      advisorMemberId,
      startsAt: new Date("2026-10-05T14:00:00Z"),
      endsAt: new Date("2026-10-05T14:30:00Z"),
      timeZone: "America/Bogota",
    });
  });

  it("removes slots that collide through appointment buffers", () => {
    const base = snapshot();
    const busySnapshot: CalendarSchedulingSnapshot = {
      ...base,
      busyEvents: [
        {
          id: "019b0000-0000-7000-8000-000000000105",
          calendarId,
          contactId: null,
          opportunityId: null,
          advisorMemberId,
          createdByMemberId: advisorMemberId,
          guestName: null,
          guestEmail: null,
          type: "APPOINTMENT",
          status: "CONFIRMED",
          origin: "MANUAL",
          title: "Ocupada",
          description: "",
          location: null,
          startsAt: new Date("2026-10-05T15:00:00Z"),
          endsAt: new Date("2026-10-05T15:30:00Z"),
          timeZone: "America/Bogota",
          version: 1n,
          createdAt: new Date("2026-10-01T12:00:00Z"),
          updatedAt: new Date("2026-10-01T12:00:00Z"),
        },
      ],
    };

    const starts = calculateAvailableSlots({
      snapshot: busySnapshot,
      from: new Date("2026-10-05T13:00:00Z"),
      to: new Date("2026-10-05T18:00:00Z"),
    }).map((slot) => slot.startsAt.toISOString());

    expect(starts).toEqual([
      "2026-10-05T14:00:00.000Z",
      "2026-10-05T16:00:00.000Z",
      "2026-10-05T16:30:00.000Z",
    ]);
  });

  it("lets an unavailable date exception close the complete day", () => {
    const base = snapshot();
    const closed: CalendarSchedulingSnapshot = {
      ...base,
      exceptions: [
        {
          id: "019b0000-0000-7000-8000-000000000106",
          calendarId,
          advisorMemberId,
          date: "2026-10-05",
          available: false,
          startMinute: null,
          endMinute: null,
          reason: "Ausencia",
        },
      ],
    };

    expect(
      calculateAvailableSlots({
        snapshot: closed,
        from: new Date("2026-10-05T13:00:00Z"),
        to: new Date("2026-10-05T18:00:00Z"),
      }),
    ).toEqual([]);
  });
});
