import type { CommercialActor } from "../iam/index.js";

export type CalendarEventType = "APPOINTMENT" | "MEETING" | "EVENT";
export type CalendarEventStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
export type CalendarEventOrigin = "MANUAL" | "AUTOMATION" | "AGENT" | "BOOKING";

export interface CalendarDefinitionRecord {
  readonly id: string;
  readonly name: string;
  readonly serviceName: string;
  readonly location: string | null;
  readonly timeZone: string;
  readonly slotDurationMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly bookingSlug: string;
  readonly active: boolean;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CalendarAvailabilityRuleRecord {
  readonly id: string;
  readonly calendarId: string;
  readonly advisorMemberId: string;
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface CalendarAvailabilityExceptionRecord {
  readonly id: string;
  readonly calendarId: string;
  readonly advisorMemberId: string;
  readonly date: string;
  readonly available: boolean;
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly reason: string | null;
}

export interface CalendarEventRecord {
  readonly id: string;
  readonly calendarId: string;
  readonly contactId: string | null;
  readonly opportunityId: string | null;
  readonly advisorMemberId: string;
  readonly createdByMemberId: string | null;
  readonly guestName: string | null;
  readonly guestEmail: string | null;
  readonly type: CalendarEventType;
  readonly status: CalendarEventStatus;
  readonly origin: CalendarEventOrigin;
  readonly title: string;
  readonly description: string;
  readonly location: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CalendarEventHistoryRecord {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: "CREATED" | "UPDATED" | "RESCHEDULED" | "STATUS_CHANGED";
  readonly actorType: "MEMBER" | "PUBLIC" | "SYSTEM";
  readonly actorMemberId: string | null;
  readonly previousValue: string | null;
  readonly nextValue: string | null;
  readonly createdAt: Date;
}

export interface CalendarEventFilters {
  readonly calendarId?: string;
  readonly contactId?: string;
  readonly opportunityId?: string;
  readonly advisorMemberId?: string;
  readonly status?: CalendarEventStatus;
  readonly type?: CalendarEventType;
  readonly from?: Date;
  readonly to?: Date;
}

export interface CalendarEventPatch {
  readonly contactId?: string | null;
  readonly opportunityId?: string | null;
  readonly advisorMemberId?: string;
  readonly type?: CalendarEventType;
  readonly title?: string;
  readonly description?: string;
  readonly location?: string | null;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
  readonly timeZone?: string;
}

export interface AvailableCalendarSlot {
  readonly calendarId: string;
  readonly advisorMemberId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
}

export interface CalendarSchedulingSnapshot {
  readonly calendar: CalendarDefinitionRecord;
  readonly rules: readonly CalendarAvailabilityRuleRecord[];
  readonly exceptions: readonly CalendarAvailabilityExceptionRecord[];
  readonly busyEvents: readonly CalendarEventRecord[];
}

export interface CalendarRepository {
  readonly listCalendars: () => Promise<readonly CalendarDefinitionRecord[]>;
  readonly findCalendar: (id: string) => Promise<CalendarDefinitionRecord | null>;
  readonly findCalendarBySlug: (slug: string) => Promise<CalendarDefinitionRecord | null>;
  readonly createCalendar: (input: {
    readonly calendar: CalendarDefinitionRecord;
    readonly actorMemberId: string;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<CalendarDefinitionRecord>;
  readonly updateCalendar: (input: {
    readonly id: string;
    readonly actorMemberId: string;
    readonly patch: Partial<
      Pick<
        CalendarDefinitionRecord,
        | "name"
        | "serviceName"
        | "location"
        | "timeZone"
        | "slotDurationMinutes"
        | "bufferBeforeMinutes"
        | "bufferAfterMinutes"
        | "active"
      >
    >;
    readonly expectedVersion: bigint;
    readonly now: Date;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<CalendarDefinitionRecord | null>;
  readonly configuration: (calendarId: string) => Promise<{
    readonly calendar: CalendarDefinitionRecord;
    readonly rules: readonly CalendarAvailabilityRuleRecord[];
    readonly exceptions: readonly CalendarAvailabilityExceptionRecord[];
  } | null>;
  readonly replaceAvailability: (input: {
    readonly calendarId: string;
    readonly actorMemberId: string;
    readonly rules: readonly CalendarAvailabilityRuleRecord[];
    readonly exceptions: readonly CalendarAvailabilityExceptionRecord[];
    readonly idempotencyKey: string;
    readonly payloadHash: string;
  }) => Promise<{
    readonly calendar: CalendarDefinitionRecord;
    readonly rules: readonly CalendarAvailabilityRuleRecord[];
    readonly exceptions: readonly CalendarAvailabilityExceptionRecord[];
  } | null>;
  readonly schedulingSnapshot: (
    calendarId: string,
    from: Date,
    to: Date,
    advisorMemberId?: string,
  ) => Promise<CalendarSchedulingSnapshot | null>;
  readonly listEvents: (
    actor: CommercialActor,
    filters: CalendarEventFilters,
  ) => Promise<readonly CalendarEventRecord[]>;
  readonly findEvent: (actor: CommercialActor, id: string) => Promise<CalendarEventRecord | null>;
  readonly createEvent: (input: {
    readonly event: CalendarEventRecord;
    readonly principalKey: string;
    readonly actorType: CalendarEventHistoryRecord["actorType"];
    readonly actorMemberId: string | null;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<CalendarEventRecord>;
  readonly updateEvent: (input: {
    readonly actor: CommercialActor;
    readonly id: string;
    readonly patch: CalendarEventPatch;
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<CalendarEventRecord | null>;
  readonly updateEventStatus: (input: {
    readonly actor: CommercialActor;
    readonly id: string;
    readonly status: CalendarEventStatus;
    readonly expectedVersion: bigint;
    readonly idempotencyKey: string;
    readonly payloadHash: string;
    readonly now: Date;
  }) => Promise<CalendarEventRecord | null>;
  readonly history: (
    actor: CommercialActor,
    eventId: string,
  ) => Promise<readonly CalendarEventHistoryRecord[]>;
}

export interface CalendarReferenceLookup {
  readonly contactExistsFor: (actor: CommercialActor, contactId: string) => Promise<boolean>;
  readonly opportunityExistsFor: (
    actor: CommercialActor,
    opportunityId: string,
  ) => Promise<boolean>;
  readonly isActiveMember: (memberId: string) => Promise<boolean>;
}

export class CalendarValidationError extends Error {
  public constructor(message = "Invalid calendar operation") {
    super(message);
    this.name = "CalendarValidationError";
  }
}
export class CalendarNotFoundError extends Error {
  public constructor() {
    super("Calendar resource not found");
    this.name = "CalendarNotFoundError";
  }
}
export class CalendarVersionConflictError extends Error {
  public constructor() {
    super("Calendar resource has changed");
    this.name = "CalendarVersionConflictError";
  }
}
export class CalendarSlotConflictError extends Error {
  public constructor() {
    super("Calendar slot is not available");
    this.name = "CalendarSlotConflictError";
  }
}

export { CalendarService, calculateAvailableSlots } from "./calendar-service.js";
