import { randomUUID } from "node:crypto";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import {
  type AvailableCalendarSlot,
  type CalendarAvailabilityExceptionRecord,
  type CalendarAvailabilityRuleRecord,
  type CalendarEventFilters,
  type CalendarEventPatch,
  type CalendarEventRecord,
  CalendarNotFoundError,
  type CalendarReferenceLookup,
  type CalendarRepository,
  CalendarSlotConflictError,
  type CalendarSchedulingSnapshot,
  CalendarValidationError,
  CalendarVersionConflictError,
} from "./index.js";

function allow(permissions: readonly IamPermission[], permission: IamPermission): void {
  if (!permissions.includes(permission)) throw new IamAuthorizationError();
}

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function requireZone(value: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    throw new CalendarValidationError("Invalid IANA time zone");
  }
}

function localDate(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localInstant(date: string, minute: number, timeZone: string): Date {
  const [yearText, monthText, dayText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;
  const desired = Date.UTC(year, month - 1, day, hour, minuteOfHour);
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const number = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((entry) => entry.type === type)?.value ?? "0");
    const represented = Date.UTC(
      number("year"),
      number("month") - 1,
      number("day"),
      number("hour"),
      number("minute"),
    );
    candidate -= represented - desired;
  }
  return new Date(candidate);
}

function civilDates(from: Date, to: Date, timeZone: string): readonly string[] {
  const start = localDate(from, timeZone);
  const end = localDate(new Date(to.getTime() - 1), timeZone);
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const result: string[] = [];
  for (let index = 0; index < 32; index += 1) {
    const date = new Date(Date.UTC(startYear!, startMonth! - 1, startDay! + index));
    const value = date.toISOString().slice(0, 10);
    result.push(value);
    if (value === end) break;
  }
  return Object.freeze(result);
}

function dateWeekday(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA < endB && endA > startB;
}

export function calculateAvailableSlots(input: {
  readonly snapshot: CalendarSchedulingSnapshot;
  readonly from: Date;
  readonly to: Date;
  readonly durationMinutes?: number;
  readonly advisorMemberId?: string;
}): readonly AvailableCalendarSlot[] {
  const { calendar } = input.snapshot;
  if (!validDate(input.from) || !validDate(input.to) || input.from >= input.to)
    throw new CalendarValidationError();
  const duration = input.durationMinutes ?? calendar.slotDurationMinutes;
  if (!Number.isInteger(duration) || duration < 5 || duration > 480)
    throw new CalendarValidationError();
  const advisors = [
    ...new Set(
      input.snapshot.rules
        .map((rule) => rule.advisorMemberId)
        .filter((id) => input.advisorMemberId === undefined || id === input.advisorMemberId),
    ),
  ];
  const slots: AvailableCalendarSlot[] = [];
  for (const date of civilDates(input.from, input.to, calendar.timeZone)) {
    const weekday = dateWeekday(date);
    for (const advisorMemberId of advisors) {
      const exceptions = input.snapshot.exceptions.filter(
        (entry) => entry.advisorMemberId === advisorMemberId && entry.date === date,
      );
      const blocked = exceptions.some((entry) => !entry.available);
      const windows = blocked
        ? []
        : exceptions.some((entry) => entry.available)
          ? exceptions.flatMap((entry) =>
              entry.available && entry.startMinute !== null && entry.endMinute !== null
                ? [{ startMinute: entry.startMinute, endMinute: entry.endMinute }]
                : [],
            )
          : input.snapshot.rules.filter(
              (rule) => rule.advisorMemberId === advisorMemberId && rule.weekday === weekday,
            );
      for (const window of windows) {
        const windowEnd = localInstant(date, window.endMinute, calendar.timeZone);
        for (
          let startsAt = localInstant(date, window.startMinute, calendar.timeZone);
          startsAt.getTime() + duration * 60_000 <= windowEnd.getTime();
          startsAt = new Date(startsAt.getTime() + calendar.slotDurationMinutes * 60_000)
        ) {
          const endsAt = new Date(startsAt.getTime() + duration * 60_000);
          if (startsAt < input.from || endsAt > input.to) continue;
          const occupiedStart = new Date(
            startsAt.getTime() - calendar.bufferBeforeMinutes * 60_000,
          );
          const occupiedEnd = new Date(endsAt.getTime() + calendar.bufferAfterMinutes * 60_000);
          const busy = input.snapshot.busyEvents.some(
            (event) =>
              event.advisorMemberId === advisorMemberId &&
              (event.status === "PENDING" || event.status === "CONFIRMED") &&
              overlaps(
                occupiedStart,
                occupiedEnd,
                new Date(event.startsAt.getTime() - calendar.bufferBeforeMinutes * 60_000),
                new Date(event.endsAt.getTime() + calendar.bufferAfterMinutes * 60_000),
              ),
          );
          if (!busy)
            slots.push(
              Object.freeze({
                calendarId: calendar.id,
                advisorMemberId,
                startsAt,
                endsAt,
                timeZone: calendar.timeZone,
              }),
            );
          if (slots.length >= 1_000) return Object.freeze(slots);
        }
      }
    }
  }
  return Object.freeze(
    slots.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime()),
  );
}

function slug(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
  return `${base || "calendario"}-${randomUUID().replace(/-/gu, "").slice(0, 8)}`;
}

function validateWindows(rules: readonly CalendarAvailabilityRuleRecord[]): void {
  for (const rule of rules) {
    if (
      !Number.isInteger(rule.weekday) ||
      rule.weekday < 0 ||
      rule.weekday > 6 ||
      !Number.isInteger(rule.startMinute) ||
      !Number.isInteger(rule.endMinute) ||
      rule.startMinute < 0 ||
      rule.endMinute > 1_440 ||
      rule.startMinute >= rule.endMinute
    )
      throw new CalendarValidationError();
    const conflict = rules.some(
      (candidate) =>
        candidate !== rule &&
        candidate.advisorMemberId === rule.advisorMemberId &&
        candidate.weekday === rule.weekday &&
        candidate.startMinute < rule.endMinute &&
        candidate.endMinute > rule.startMinute,
    );
    if (conflict) throw new CalendarValidationError("Availability ranges overlap");
  }
}

function transitionAllowed(
  from: CalendarEventRecord["status"],
  to: CalendarEventRecord["status"],
): boolean {
  if (from === to) return true;
  if (from === "CANCELLED" || from === "COMPLETED" || from === "NO_SHOW") return false;
  return ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(to);
}

export class CalendarService {
  public constructor(
    private readonly repository: CalendarRepository,
    private readonly references: CalendarReferenceLookup,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public async listCalendars(permissions: readonly IamPermission[]) {
    allow(permissions, "crm:calendar:read");
    return this.repository.listCalendars();
  }

  public async createCalendar(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly name: string;
    readonly serviceName: string;
    readonly location: string | null;
    readonly timeZone: string;
    readonly slotDurationMinutes: number;
    readonly bufferBeforeMinutes: number;
    readonly bufferAfterMinutes: number;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:calendar:configure");
    requireZone(input.timeZone);
    const now = this.clock();
    return this.repository.createCalendar({
      calendar: Object.freeze({
        id: randomUUID(),
        name: input.name.trim(),
        serviceName: input.serviceName.trim(),
        location: input.location?.trim() || null,
        timeZone: input.timeZone,
        slotDurationMinutes: input.slotDurationMinutes,
        bufferBeforeMinutes: input.bufferBeforeMinutes,
        bufferAfterMinutes: input.bufferAfterMinutes,
        bookingSlug: slug(input.name),
        active: true,
        version: 1n,
        createdAt: now,
        updatedAt: now,
      }),
      actorMemberId: input.actor.memberId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
  }

  public async updateCalendar(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly patch: Parameters<CalendarRepository["updateCalendar"]>[0]["patch"];
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:calendar:configure");
    if (input.patch.timeZone) requireZone(input.patch.timeZone);
    const result = await this.repository.updateCalendar({
      id: input.id,
      actorMemberId: input.actor.memberId,
      patch: input.patch,
      expectedVersion: input.expectedVersion,
      now: this.clock(),
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new CalendarVersionConflictError();
    return result;
  }

  public async configuration(permissions: readonly IamPermission[], calendarId: string) {
    allow(permissions, "crm:calendar:read");
    const result = await this.repository.configuration(calendarId);
    if (!result) throw new CalendarNotFoundError();
    return result;
  }

  public async replaceAvailability(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly calendarId: string;
    readonly rules: readonly Omit<CalendarAvailabilityRuleRecord, "id" | "calendarId">[];
    readonly exceptions: readonly Omit<CalendarAvailabilityExceptionRecord, "id" | "calendarId">[];
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:calendar:configure");
    const rules = input.rules.map((rule) =>
      Object.freeze({ ...rule, id: randomUUID(), calendarId: input.calendarId }),
    );
    validateWindows(rules);
    const advisors = new Set([
      ...rules.map((rule) => rule.advisorMemberId),
      ...input.exceptions.map((entry) => entry.advisorMemberId),
    ]);
    for (const memberId of advisors) {
      if (!(await this.references.isActiveMember(memberId))) throw new CalendarNotFoundError();
    }
    const exceptions = input.exceptions.map((entry) => {
      if (
        entry.available !== (entry.startMinute !== null && entry.endMinute !== null) ||
        (entry.startMinute !== null &&
          entry.endMinute !== null &&
          entry.startMinute >= entry.endMinute)
      )
        throw new CalendarValidationError();
      return Object.freeze({ ...entry, id: randomUUID(), calendarId: input.calendarId });
    });
    const result = await this.repository.replaceAvailability({
      calendarId: input.calendarId,
      actorMemberId: input.actor.memberId,
      rules,
      exceptions,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (!result) throw new CalendarNotFoundError();
    return result;
  }

  public async availability(input: {
    readonly permissions: readonly IamPermission[];
    readonly calendarId: string;
    readonly advisorMemberId?: string;
    readonly from: Date;
    readonly to: Date;
    readonly durationMinutes?: number;
  }) {
    allow(input.permissions, "crm:calendar:read");
    const snapshot = await this.repository.schedulingSnapshot(
      input.calendarId,
      input.from,
      input.to,
      input.advisorMemberId,
    );
    if (!snapshot) throw new CalendarNotFoundError();
    return calculateAvailableSlots({ ...input, snapshot });
  }

  public async publicAvailability(input: {
    readonly slug: string;
    readonly advisorMemberId?: string;
    readonly from: Date;
    readonly to: Date;
    readonly durationMinutes?: number;
  }) {
    const calendar = await this.repository.findCalendarBySlug(input.slug);
    if (!calendar?.active) throw new CalendarNotFoundError();
    const snapshot = await this.repository.schedulingSnapshot(
      calendar.id,
      input.from,
      input.to,
      input.advisorMemberId,
    );
    if (!snapshot) throw new CalendarNotFoundError();
    return Object.freeze({
      calendar,
      slots: calculateAvailableSlots({ ...input, snapshot }),
    });
  }

  public async listEvents(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    filters: CalendarEventFilters,
  ) {
    allow(permissions, "crm:calendar:read");
    return this.repository.listEvents(actor, filters);
  }

  private async validateReferences(
    actor: CommercialActor,
    input: { readonly contactId?: string | null; readonly opportunityId?: string | null },
  ): Promise<void> {
    if (input.contactId && !(await this.references.contactExistsFor(actor, input.contactId)))
      throw new CalendarNotFoundError();
    if (
      input.opportunityId &&
      !(await this.references.opportunityExistsFor(actor, input.opportunityId))
    )
      throw new CalendarNotFoundError();
  }

  public async createEvent(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly calendarId: string;
    readonly contactId?: string;
    readonly opportunityId?: string;
    readonly advisorMemberId: string;
    readonly type: CalendarEventRecord["type"];
    readonly title: string;
    readonly description: string;
    readonly location: string | null;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly timeZone: string;
    readonly origin: Exclude<CalendarEventRecord["origin"], "BOOKING">;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:calendar:create");
    await this.validateReferences(input.actor, input);
    if (!(await this.references.isActiveMember(input.advisorMemberId)))
      throw new CalendarNotFoundError();
    const calendar = await this.repository.findCalendar(input.calendarId);
    if (!calendar?.active) throw new CalendarNotFoundError();
    requireZone(input.timeZone);
    if (!validDate(input.startsAt) || !validDate(input.endsAt) || input.startsAt >= input.endsAt)
      throw new CalendarValidationError();
    const now = this.clock();
    return this.repository.createEvent({
      event: Object.freeze({
        id: randomUUID(),
        calendarId: input.calendarId,
        contactId: input.contactId ?? null,
        opportunityId: input.opportunityId ?? null,
        advisorMemberId: input.advisorMemberId,
        createdByMemberId: input.actor.memberId,
        guestName: null,
        guestEmail: null,
        type: input.type,
        status: "PENDING",
        origin: input.origin,
        title: input.title.trim(),
        description: input.description.trim(),
        location: input.location?.trim() || calendar.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timeZone: input.timeZone,
        version: 1n,
        createdAt: now,
        updatedAt: now,
      }),
      principalKey: `member:${input.actor.memberId}`,
      actorType: "MEMBER",
      actorMemberId: input.actor.memberId,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      now,
    });
  }

  public async publicBook(input: {
    readonly slug: string;
    readonly advisorMemberId: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly guestName: string;
    readonly guestEmail: string;
    readonly notes: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    const available = await this.publicAvailability({
      slug: input.slug,
      advisorMemberId: input.advisorMemberId,
      from: input.startsAt,
      to: input.endsAt,
      durationMinutes: Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000),
    });
    const offered = available.slots.some(
      (slot) =>
        slot.advisorMemberId === input.advisorMemberId &&
        slot.startsAt.getTime() === input.startsAt.getTime() &&
        slot.endsAt.getTime() === input.endsAt.getTime(),
    );
    if (!offered) throw new CalendarSlotConflictError();
    const now = this.clock();
    return this.repository.createEvent({
      event: Object.freeze({
        id: randomUUID(),
        calendarId: available.calendar.id,
        contactId: null,
        opportunityId: null,
        advisorMemberId: input.advisorMemberId,
        createdByMemberId: null,
        guestName: input.guestName.trim(),
        guestEmail: input.guestEmail.trim().toLowerCase(),
        type: "APPOINTMENT",
        status: "CONFIRMED",
        origin: "BOOKING",
        title: available.calendar.serviceName,
        description: input.notes.trim(),
        location: available.calendar.location,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timeZone: available.calendar.timeZone,
        version: 1n,
        createdAt: now,
        updatedAt: now,
      }),
      principalKey: `booking:${available.calendar.id}`,
      actorType: "PUBLIC",
      actorMemberId: null,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      now,
    });
  }

  public async updateEvent(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly patch: CalendarEventPatch;
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:calendar:update");
    const current = await this.repository.findEvent(input.actor, input.id);
    if (!current) throw new CalendarNotFoundError();
    await this.validateReferences(input.actor, input.patch);
    if (
      input.patch.advisorMemberId &&
      !(await this.references.isActiveMember(input.patch.advisorMemberId))
    )
      throw new CalendarNotFoundError();
    if (input.patch.timeZone) requireZone(input.patch.timeZone);
    const startsAt = input.patch.startsAt ?? current.startsAt;
    const endsAt = input.patch.endsAt ?? current.endsAt;
    if (!validDate(startsAt) || !validDate(endsAt) || startsAt >= endsAt)
      throw new CalendarValidationError();
    const result = await this.repository.updateEvent({
      actor: input.actor,
      id: input.id,
      patch: input.patch,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      now: this.clock(),
    });
    if (!result) throw new CalendarVersionConflictError();
    return result;
  }

  public async updateEventStatus(input: {
    readonly actor: CommercialActor;
    readonly permissions: readonly IamPermission[];
    readonly id: string;
    readonly status: CalendarEventRecord["status"];
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) {
    allow(input.permissions, "crm:calendar:update");
    const current = await this.repository.findEvent(input.actor, input.id);
    if (!current) throw new CalendarNotFoundError();
    if (!transitionAllowed(current.status, input.status)) throw new CalendarValidationError();
    const result = await this.repository.updateEventStatus({
      actor: input.actor,
      id: input.id,
      status: input.status,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
      now: this.clock(),
    });
    if (!result) throw new CalendarVersionConflictError();
    return result;
  }

  public async history(
    actor: CommercialActor,
    permissions: readonly IamPermission[],
    eventId: string,
  ) {
    allow(permissions, "crm:calendar:read");
    if (!(await this.repository.findEvent(actor, eventId))) throw new CalendarNotFoundError();
    return this.repository.history(actor, eventId);
  }
}
