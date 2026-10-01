import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  PreconditionFailedException,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  CalendarAvailabilityQuerySchema,
  CalendarAvailabilityResponseSchema,
  CalendarConfigurationResponseSchema,
  CalendarEventHistoryListResponseSchema,
  CalendarEventListQuerySchema,
  CalendarEventListResponseSchema,
  CalendarEventResponseSchema,
  CalendarListResponseSchema,
  CalendarResponseSchema,
  CreateCalendarEventSchema,
  CreateCalendarSchema,
  PublicCalendarAvailabilityQuerySchema,
  PublicCalendarAvailabilityResponseSchema,
  PublicCalendarBookingSchema,
  ReplaceCalendarAvailabilitySchema,
  UpdateCalendarEventSchema,
  UpdateCalendarEventStatusSchema,
  UpdateCalendarSchema,
} from "@quantum-crm/contracts";
import {
  CalendarNotFoundError,
  CalendarService,
  CalendarSlotConflictError,
  CalendarValidationError,
  CalendarVersionConflictError,
  IamAuthorizationError,
  type CalendarAvailabilityExceptionRecord,
  type CalendarAvailabilityRuleRecord,
  type CalendarDefinitionRecord,
  type CalendarEventHistoryRecord,
  type CalendarEventRecord,
  type CommercialActor,
  type IamPermission,
} from "@quantum-crm/domain";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";

import { CrmPublicRoute, crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const CALENDAR_SERVICE = Symbol("CALENDAR_SERVICE");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{8}$/u;
const keyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;

function key(value: string | undefined): string {
  if (!value || !keyPattern.test(value)) throw new BadRequestException();
  return value;
}
function version(value: string | undefined): bigint {
  const match = typeof value === "string" ? /^"([1-9][0-9]*)"$/u.exec(value) : null;
  if (!match?.[1])
    throw new HttpException("If-Match is required", HttpStatus.PRECONDITION_REQUIRED);
  return BigInt(match[1]);
}
function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function identity(request: Parameters<typeof crmAuthContext>[0]): {
  readonly actor: CommercialActor;
  readonly permissions: readonly IamPermission[];
} {
  const context = crmAuthContext(request);
  return Object.freeze({
    actor: Object.freeze({ memberId: context.principal.id, scope: context.commercialScope }),
    permissions: context.permissions as readonly IamPermission[],
  });
}
function calendar(record: CalendarDefinitionRecord) {
  return {
    ...record,
    version: record.version.toString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
function event(record: CalendarEventRecord) {
  return {
    ...record,
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    version: record.version.toString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
function history(record: CalendarEventHistoryRecord) {
  return { ...record, createdAt: record.createdAt.toISOString() };
}
function configuration(record: {
  readonly calendar: CalendarDefinitionRecord;
  readonly rules: readonly CalendarAvailabilityRuleRecord[];
  readonly exceptions: readonly CalendarAvailabilityExceptionRecord[];
}) {
  return { ...record, calendar: calendar(record.calendar) };
}
function map(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof CalendarNotFoundError) throw new NotFoundException();
  if (
    error instanceof CalendarSlotConflictError ||
    error instanceof CommercialIdempotencyConflictError
  )
    throw new ConflictException();
  if (error instanceof CalendarVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof CalendarValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/calendar")
export class CalendarController {
  public constructor(@Inject(CALENDAR_SERVICE) private readonly service: CalendarService) {}

  @Get("calendars")
  @RequireCrmPermission("crm:calendar:read")
  public async calendars(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      const auth = identity(request);
      return CalendarListResponseSchema.parse({
        data: (await this.service.listCalendars(auth.permissions)).map(calendar),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("calendars")
  @RequireCrmPermission("crm:calendar:configure")
  public async createCalendar(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateCalendarSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      return CalendarResponseSchema.parse({
        data: calendar(
          await this.service.createCalendar({
            ...auth,
            ...parsed.data,
            location: parsed.data.location ?? null,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(parsed.data),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("calendars/:calendarId")
  @RequireCrmPermission("crm:calendar:read")
  public async configuration(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("calendarId") calendarId: string,
  ) {
    if (!uuidPattern.test(calendarId)) throw new BadRequestException();
    try {
      const auth = identity(request);
      return CalendarConfigurationResponseSchema.parse({
        data: configuration(await this.service.configuration(auth.permissions, calendarId)),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Patch("calendars/:calendarId")
  @RequireCrmPermission("crm:calendar:configure")
  public async updateCalendar(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("calendarId") calendarId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(calendarId)) throw new BadRequestException();
    try {
      const parsed = UpdateCalendarSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const expectedVersion = version(ifMatch);
      const patch = {
        ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
        ...(parsed.data.serviceName === undefined ? {} : { serviceName: parsed.data.serviceName }),
        ...(parsed.data.location === undefined ? {} : { location: parsed.data.location }),
        ...(parsed.data.timeZone === undefined ? {} : { timeZone: parsed.data.timeZone }),
        ...(parsed.data.slotDurationMinutes === undefined
          ? {}
          : { slotDurationMinutes: parsed.data.slotDurationMinutes }),
        ...(parsed.data.bufferBeforeMinutes === undefined
          ? {}
          : { bufferBeforeMinutes: parsed.data.bufferBeforeMinutes }),
        ...(parsed.data.bufferAfterMinutes === undefined
          ? {}
          : { bufferAfterMinutes: parsed.data.bufferAfterMinutes }),
        ...(parsed.data.active === undefined ? {} : { active: parsed.data.active }),
      };
      return CalendarResponseSchema.parse({
        data: calendar(
          await this.service.updateCalendar({
            ...auth,
            id: calendarId,
            patch,
            expectedVersion,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              calendarId,
              ...parsed.data,
              expectedVersion: expectedVersion.toString(),
            }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Put("calendars/:calendarId/availability")
  @RequireCrmPermission("crm:calendar:configure")
  public async replaceAvailability(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("calendarId") calendarId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(calendarId)) throw new BadRequestException();
    try {
      const parsed = ReplaceCalendarAvailabilitySchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      return CalendarConfigurationResponseSchema.parse({
        data: configuration(
          await this.service.replaceAvailability({
            ...auth,
            calendarId,
            ...parsed.data,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({ calendarId, ...parsed.data }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("availability")
  @RequireCrmPermission("crm:calendar:read")
  public async availability(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query() query: unknown,
  ) {
    try {
      const parsed = CalendarAvailabilityQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const slots = await this.service.availability({
        permissions: auth.permissions,
        calendarId: parsed.data.calendarId,
        ...(parsed.data.advisorMemberId === undefined
          ? {}
          : { advisorMemberId: parsed.data.advisorMemberId }),
        from: new Date(parsed.data.from),
        to: new Date(parsed.data.to),
        ...(parsed.data.durationMinutes === undefined
          ? {}
          : { durationMinutes: parsed.data.durationMinutes }),
      });
      return CalendarAvailabilityResponseSchema.parse({
        data: slots.map((slot) => ({
          ...slot,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
        })),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("events")
  @RequireCrmPermission("crm:calendar:read")
  public async events(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Query() query: unknown,
  ) {
    try {
      const parsed = CalendarEventListQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const { from, to } = parsed.data;
      const filters = {
        ...(parsed.data.calendarId === undefined ? {} : { calendarId: parsed.data.calendarId }),
        ...(parsed.data.contactId === undefined ? {} : { contactId: parsed.data.contactId }),
        ...(parsed.data.opportunityId === undefined
          ? {}
          : { opportunityId: parsed.data.opportunityId }),
        ...(parsed.data.advisorMemberId === undefined
          ? {}
          : { advisorMemberId: parsed.data.advisorMemberId }),
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.type === undefined ? {} : { type: parsed.data.type }),
      };
      return CalendarEventListResponseSchema.parse({
        data: (
          await this.service.listEvents(auth.actor, auth.permissions, {
            ...filters,
            ...(from === undefined ? {} : { from: new Date(from) }),
            ...(to === undefined ? {} : { to: new Date(to) }),
          })
        ).map(event),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("events")
  @RequireCrmPermission("crm:calendar:create")
  public async createEvent(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const parsed = CreateCalendarEventSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const payload = parsed.data;
      if (payload.origin === "BOOKING") throw new BadRequestException();
      const origin: "MANUAL" | "AUTOMATION" | "AGENT" = payload.origin;
      return CalendarEventResponseSchema.parse({
        data: event(
          await this.service.createEvent({
            ...auth,
            calendarId: payload.calendarId,
            ...(payload.contactId === undefined ? {} : { contactId: payload.contactId }),
            ...(payload.opportunityId === undefined
              ? {}
              : { opportunityId: payload.opportunityId }),
            advisorMemberId: payload.advisorMemberId,
            type: payload.type,
            title: payload.title,
            description: payload.description,
            location: payload.location ?? null,
            startsAt: new Date(payload.startsAt),
            endsAt: new Date(payload.endsAt),
            timeZone: payload.timeZone,
            origin,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash(payload),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Patch("events/:eventId")
  @RequireCrmPermission("crm:calendar:update")
  public async updateEvent(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("eventId") eventId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(eventId)) throw new BadRequestException();
    try {
      const parsed = UpdateCalendarEventSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const expectedVersion = version(ifMatch);
      const { startsAt, endsAt } = parsed.data;
      const patch = {
        ...(parsed.data.contactId === undefined ? {} : { contactId: parsed.data.contactId }),
        ...(parsed.data.opportunityId === undefined
          ? {}
          : { opportunityId: parsed.data.opportunityId }),
        ...(parsed.data.advisorMemberId === undefined
          ? {}
          : { advisorMemberId: parsed.data.advisorMemberId }),
        ...(parsed.data.type === undefined ? {} : { type: parsed.data.type }),
        ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
        ...(parsed.data.description === undefined ? {} : { description: parsed.data.description }),
        ...(parsed.data.location === undefined ? {} : { location: parsed.data.location }),
        ...(parsed.data.timeZone === undefined ? {} : { timeZone: parsed.data.timeZone }),
        ...(startsAt === undefined ? {} : { startsAt: new Date(startsAt) }),
        ...(endsAt === undefined ? {} : { endsAt: new Date(endsAt) }),
      };
      return CalendarEventResponseSchema.parse({
        data: event(
          await this.service.updateEvent({
            ...auth,
            id: eventId,
            patch,
            expectedVersion,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              eventId,
              ...parsed.data,
              expectedVersion: expectedVersion.toString(),
            }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Patch("events/:eventId/status")
  @RequireCrmPermission("crm:calendar:update")
  public async updateEventStatus(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("eventId") eventId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!uuidPattern.test(eventId)) throw new BadRequestException();
    try {
      const parsed = UpdateCalendarEventStatusSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      const auth = identity(request);
      const expectedVersion = version(ifMatch);
      return CalendarEventResponseSchema.parse({
        data: event(
          await this.service.updateEventStatus({
            ...auth,
            id: eventId,
            status: parsed.data.status,
            expectedVersion,
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({
              eventId,
              ...parsed.data,
              expectedVersion: expectedVersion.toString(),
            }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("events/:eventId/history")
  @RequireCrmPermission("crm:calendar:read")
  public async history(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("eventId") eventId: string,
  ) {
    if (!uuidPattern.test(eventId)) throw new BadRequestException();
    try {
      const auth = identity(request);
      return CalendarEventHistoryListResponseSchema.parse({
        data: (await this.service.history(auth.actor, auth.permissions, eventId)).map(history),
      });
    } catch (error) {
      return map(error);
    }
  }

  @Get("public/:slug")
  @CrmPublicRoute()
  public async publicAvailability(@Param("slug") slug: string, @Query() query: unknown) {
    if (!slugPattern.test(slug)) throw new NotFoundException();
    try {
      const parsed = PublicCalendarAvailabilityQuerySchema.safeParse(query);
      if (!parsed.success) throw new BadRequestException();
      const result = await this.service.publicAvailability({
        slug,
        ...(parsed.data.advisorMemberId === undefined
          ? {}
          : { advisorMemberId: parsed.data.advisorMemberId }),
        from: new Date(parsed.data.from),
        to: new Date(parsed.data.to),
        ...(parsed.data.durationMinutes === undefined
          ? {}
          : { durationMinutes: parsed.data.durationMinutes }),
      });
      return PublicCalendarAvailabilityResponseSchema.parse({
        data: {
          calendar: calendar(result.calendar),
          slots: result.slots.map((slot) => ({
            ...slot,
            startsAt: slot.startsAt.toISOString(),
            endsAt: slot.endsAt.toISOString(),
          })),
        },
      });
    } catch (error) {
      return map(error);
    }
  }

  @Post("public/:slug")
  @CrmPublicRoute()
  public async publicBook(
    @Param("slug") slug: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!slugPattern.test(slug)) throw new NotFoundException();
    try {
      const parsed = PublicCalendarBookingSchema.safeParse(body);
      if (!parsed.success) throw new BadRequestException();
      return CalendarEventResponseSchema.parse({
        data: event(
          await this.service.publicBook({
            slug,
            ...parsed.data,
            startsAt: new Date(parsed.data.startsAt),
            endsAt: new Date(parsed.data.endsAt),
            idempotencyKey: key(idempotencyKey),
            payloadHash: hash({ slug, ...parsed.data }),
          }),
        ),
      });
    } catch (error) {
      return map(error);
    }
  }
}
