import { describe, expect, it } from "vitest";

import {
  CalendarAvailabilityQuerySchema,
  CalendarEventSchema,
  CreateCalendarEventSchema,
  PublicCalendarBookingSchema,
  ReplaceCalendarAvailabilitySchema,
} from "./calendar.js";

const calendarId = "019b0000-0000-7000-8000-000000000101";
const advisorMemberId = "019b0000-0000-7000-8000-000000000102";

describe("calendar contracts", () => {
  it("accepts a bounded availability query and rejects ranges over 31 days", () => {
    expect(
      CalendarAvailabilityQuerySchema.safeParse({
        calendarId,
        from: "2026-10-01T00:00:00-05:00",
        to: "2026-10-15T00:00:00-05:00",
      }).success,
    ).toBe(true);
    expect(
      CalendarAvailabilityQuerySchema.safeParse({
        calendarId,
        from: "2026-10-01T00:00:00Z",
        to: "2026-11-15T00:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("requires valid non-overlapping-looking availability windows and exception shapes", () => {
    expect(
      ReplaceCalendarAvailabilitySchema.safeParse({
        rules: [{ advisorMemberId, weekday: 1, startMinute: 540, endMinute: 1020 }],
        exceptions: [
          {
            advisorMemberId,
            date: "2026-10-12",
            available: false,
            startMinute: null,
            endMinute: null,
            reason: "Festivo",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      ReplaceCalendarAvailabilitySchema.safeParse({
        rules: [{ advisorMemberId, weekday: 1, startMinute: 700, endMinute: 600 }],
        exceptions: [],
      }).success,
    ).toBe(false);
  });

  it("keeps internal creation and public booking strict and time ordered", () => {
    expect(
      CreateCalendarEventSchema.safeParse({
        calendarId,
        advisorMemberId,
        title: "Diagnóstico",
        startsAt: "2026-10-05T09:00:00-05:00",
        endsAt: "2026-10-05T09:30:00-05:00",
        timeZone: "America/Bogota",
      }).success,
    ).toBe(true);
    expect(
      PublicCalendarBookingSchema.safeParse({
        advisorMemberId,
        startsAt: "2026-10-05T10:00:00-05:00",
        endsAt: "2026-10-05T09:30:00-05:00",
        guestName: "Cliente",
        guestEmail: "cliente@example.com",
      }).success,
    ).toBe(false);
  });

  it("publishes complete versioned event responses", () => {
    expect(
      CalendarEventSchema.parse({
        id: "019b0000-0000-7000-8000-000000000103",
        calendarId,
        contactId: null,
        opportunityId: null,
        advisorMemberId,
        createdByMemberId: null,
        guestName: "Cliente",
        guestEmail: "cliente@example.com",
        type: "APPOINTMENT",
        status: "CONFIRMED",
        origin: "BOOKING",
        title: "Diagnóstico",
        description: "",
        location: null,
        startsAt: "2026-10-05T14:00:00Z",
        endsAt: "2026-10-05T14:30:00Z",
        timeZone: "America/Bogota",
        version: "1",
        createdAt: "2026-10-01T12:00:00Z",
        updatedAt: "2026-10-01T12:00:00Z",
      }),
    ).toMatchObject({ origin: "BOOKING", status: "CONFIRMED" });
  });
});
