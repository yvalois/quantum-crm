import { describe, expect, it, vi } from "vitest";

import { CalendarService, calculateAvailableSlots } from "./calendar-service.js";
import { IamAuthorizationError } from "../iam/index.js";
import type {
  CalendarRepository,
  CalendarReferenceLookup,
  CalendarSchedulingSnapshot,
} from "./index.js";

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
  it("hides rented intervals when shared item stock or capacity is exhausted", () => {
    const occupied: CalendarSchedulingSnapshot = {
      ...snapshot(),
      capacityLimit: 1,
      capacityReservations: [
        {
          startsAt: new Date("2026-10-05T14:00:00Z"),
          endsAt: new Date("2026-10-05T15:00:00Z"),
          quantity: 1,
        },
      ],
    };
    const starts = calculateAvailableSlots({
      snapshot: occupied,
      from: new Date("2026-10-05T13:00:00Z"),
      to: new Date("2026-10-05T18:00:00Z"),
    }).map((slot) => slot.startsAt.toISOString());
    expect(starts).not.toContain("2026-10-05T14:00:00.000Z");
    expect(starts).not.toContain("2026-10-05T14:30:00.000Z");
    expect(starts).toContain("2026-10-05T15:00:00.000Z");
  });

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

describe("advisor calendar permissions", () => {
  const actor = { memberId: advisorMemberId, scope: "PROFILE" as const };
  const references = {
    contactExistsFor: vi.fn(async () => true),
    opportunityExistsFor: vi.fn(async () => true),
    isActiveMember: vi.fn(async () => true),
  } satisfies CalendarReferenceLookup;

  it("scopes ordinary calendar reads to the assigned advisor even if their commercial scope is PROFILE", async () => {
    const listEvents = vi.fn(async () => []);
    const service = new CalendarService(
      { listEvents } as unknown as CalendarRepository,
      references,
    );
    await service.listEvents(actor, ["crm:calendar:read"], {});
    expect(listEvents).toHaveBeenCalledWith({ memberId: advisorMemberId, scope: "ASSIGNED" }, {});
    await expect(
      service.listEvents(actor, ["crm:calendar:read"], { advisorMemberId: calendarId }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
  });

  it("permits all-advisor reads only with the explicit permission", async () => {
    const listEvents = vi.fn(async () => []);
    const service = new CalendarService(
      { listEvents } as unknown as CalendarRepository,
      references,
    );
    await service.listEvents(actor, ["crm:calendar:read", "crm:calendar:read-all"], {
      advisorMemberId: calendarId,
    });
    expect(listEvents).toHaveBeenCalledWith(
      { memberId: advisorMemberId, scope: "PROFILE" },
      { advisorMemberId: calendarId },
    );
  });

  it("prevents an advisor from creating a colleague's appointment", async () => {
    const createEvent = vi.fn();
    const service = new CalendarService(
      { createEvent } as unknown as CalendarRepository,
      references,
    );
    await expect(
      service.createEvent({
        actor,
        permissions: ["crm:calendar:create"],
        calendarId,
        advisorMemberId: calendarId,
        type: "APPOINTMENT",
        title: "Visita",
        description: "",
        location: null,
        startsAt: new Date("2026-10-15T14:00:00Z"),
        endsAt: new Date("2026-10-15T14:30:00Z"),
        timeZone: "America/Bogota",
        origin: "MANUAL",
        idempotencyKey: "test-calendar",
        payloadHash: "hash",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("rejects querying another advisor's availability", async () => {
    const schedulingSnapshot = vi.fn();
    const service = new CalendarService(
      { schedulingSnapshot } as unknown as CalendarRepository,
      references,
    );
    await expect(
      service.availability({
        actor,
        permissions: ["crm:calendar:read"],
        calendarId,
        advisorMemberId: calendarId,
        from: new Date("2026-10-15T14:00:00Z"),
        to: new Date("2026-10-15T15:00:00Z"),
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(schedulingSnapshot).not.toHaveBeenCalled();
  });

  it("redacts other advisors' availability configuration", async () => {
    const base = snapshot();
    const configuration = vi.fn(async () => ({
      calendar: base.calendar,
      rules: [...base.rules, { ...base.rules[0]!, id: calendarId, advisorMemberId: calendarId }],
      exceptions: [],
    }));
    const service = new CalendarService(
      { configuration } as unknown as CalendarRepository,
      references,
    );
    const result = await service.configuration(actor, ["crm:calendar:read"], calendarId);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.advisorMemberId).toBe(advisorMemberId);
  });

  it("restricts event history to the assigned advisor without read-all", async () => {
    const findEvent = vi.fn(async () => null);
    const history = vi.fn(async () => []);
    const service = new CalendarService(
      { findEvent, history } as unknown as CalendarRepository,
      references,
    );
    await expect(service.history(actor, ["crm:calendar:read"], calendarId)).rejects.toThrow();
    expect(findEvent).toHaveBeenCalledWith(
      { memberId: advisorMemberId, scope: "ASSIGNED" },
      calendarId,
    );
    expect(history).not.toHaveBeenCalled();
  });

  it("requires calendar configuration permission to create appointment types", async () => {
    const createAppointmentType = vi.fn();
    const service = new CalendarService(
      { createAppointmentType } as unknown as CalendarRepository,
      references,
    );
    await expect(
      service.createAppointmentType({
        actor,
        permissions: ["crm:calendar:read"],
        name: "Entrega",
        durationMinutes: 30,
        idempotencyKey: "test-type",
        payloadHash: "hash",
      }),
    ).rejects.toBeInstanceOf(IamAuthorizationError);
    expect(createAppointmentType).not.toHaveBeenCalled();
  });
});
