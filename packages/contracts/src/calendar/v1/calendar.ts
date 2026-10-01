import { z } from "zod";

const IdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA time zone");
const NullableIdSchema = IdSchema.nullable();
const VersionSchema = z.string().regex(/^[1-9][0-9]*$/u);

export const CalendarEventTypeSchema = z.enum(["APPOINTMENT", "MEETING", "EVENT"]);
export const CalendarEventStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);
export const CalendarEventOriginSchema = z.enum(["MANUAL", "AUTOMATION", "AGENT", "BOOKING"]);

export const CalendarDefinitionSchema = z
  .object({
    id: IdSchema,
    name: z.string().trim().min(1).max(160),
    serviceName: z.string().trim().min(1).max(160),
    location: z.string().trim().min(1).max(500).nullable(),
    timeZone: TimeZoneSchema,
    slotDurationMinutes: z.number().int().min(5).max(480),
    bufferBeforeMinutes: z.number().int().min(0).max(240),
    bufferAfterMinutes: z.number().int().min(0).max(240),
    bookingSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{8}$/u),
    active: z.boolean(),
    version: VersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const CreateCalendarSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    serviceName: z.string().trim().min(1).max(160),
    location: z.string().trim().min(1).max(500).nullable().optional(),
    timeZone: TimeZoneSchema,
    slotDurationMinutes: z.number().int().min(5).max(480).default(30),
    bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
    bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
  })
  .strict();

export const UpdateCalendarSchema = CreateCalendarSchema.partial()
  .extend({ active: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const AvailabilityRuleSchema = z
  .object({
    id: IdSchema,
    calendarId: IdSchema,
    advisorMemberId: IdSchema,
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((value) => value.startMinute < value.endMinute, "startMinute must precede endMinute");

export const AvailabilityExceptionSchema = z
  .object({
    id: IdSchema,
    calendarId: IdSchema,
    advisorMemberId: IdSchema,
    date: z.string().date(),
    available: z.boolean(),
    startMinute: z.number().int().min(0).max(1439).nullable(),
    endMinute: z.number().int().min(1).max(1440).nullable(),
    reason: z.string().trim().min(1).max(240).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasRange = value.startMinute !== null && value.endMinute !== null;
    if (value.available !== hasRange || (hasRange && value.startMinute! >= value.endMinute!)) {
      context.addIssue({ code: "custom", message: "Available exceptions require a valid range" });
    }
  });

const AvailabilityRuleInputSchema = z
  .object({
    advisorMemberId: IdSchema,
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((value) => value.startMinute < value.endMinute, "startMinute must precede endMinute");
const AvailabilityExceptionInputSchema = z
  .object({
    advisorMemberId: IdSchema,
    date: z.string().date(),
    available: z.boolean(),
    startMinute: z.number().int().min(0).max(1439).nullable(),
    endMinute: z.number().int().min(1).max(1440).nullable(),
    reason: z.string().trim().min(1).max(240).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasRange = value.startMinute !== null && value.endMinute !== null;
    if (value.available !== hasRange || (hasRange && value.startMinute! >= value.endMinute!)) {
      context.addIssue({ code: "custom", message: "Available exceptions require a valid range" });
    }
  });
export const ReplaceCalendarAvailabilitySchema = z
  .object({
    rules: z.array(AvailabilityRuleInputSchema).max(100),
    exceptions: z.array(AvailabilityExceptionInputSchema).max(100),
  })
  .strict();

export const CalendarConfigurationSchema = z
  .object({
    calendar: CalendarDefinitionSchema,
    rules: z.array(AvailabilityRuleSchema),
    exceptions: z.array(AvailabilityExceptionSchema),
  })
  .strict();

export const CalendarEventSchema = z
  .object({
    id: IdSchema,
    calendarId: IdSchema,
    contactId: NullableIdSchema,
    opportunityId: NullableIdSchema,
    advisorMemberId: IdSchema,
    createdByMemberId: NullableIdSchema,
    guestName: z.string().trim().min(1).max(160).nullable(),
    guestEmail: z.string().email().max(320).nullable(),
    type: CalendarEventTypeSchema,
    status: CalendarEventStatusSchema,
    origin: CalendarEventOriginSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4_000),
    location: z.string().trim().min(1).max(500).nullable(),
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
    timeZone: TimeZoneSchema,
    version: VersionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
  .refine(
    (value) => Date.parse(value.startsAt) < Date.parse(value.endsAt),
    "startsAt must precede endsAt",
  );

export const CreateCalendarEventSchema = z
  .object({
    calendarId: IdSchema,
    contactId: IdSchema.optional(),
    opportunityId: IdSchema.optional(),
    advisorMemberId: IdSchema,
    type: CalendarEventTypeSchema.default("APPOINTMENT"),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4_000).default(""),
    location: z.string().trim().min(1).max(500).nullable().optional(),
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
    timeZone: TimeZoneSchema,
    origin: CalendarEventOriginSchema.default("MANUAL"),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.startsAt) < Date.parse(value.endsAt),
    "startsAt must precede endsAt",
  );

export const UpdateCalendarEventSchema = z
  .object({
    contactId: NullableIdSchema.optional(),
    opportunityId: NullableIdSchema.optional(),
    advisorMemberId: IdSchema.optional(),
    type: CalendarEventTypeSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4_000).optional(),
    location: z.string().trim().min(1).max(500).nullable().optional(),
    startsAt: TimestampSchema.optional(),
    endsAt: TimestampSchema.optional(),
    timeZone: TimeZoneSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required")
  .refine(
    (value) =>
      value.startsAt === undefined ||
      value.endsAt === undefined ||
      Date.parse(value.startsAt) < Date.parse(value.endsAt),
    "startsAt must precede endsAt",
  );

export const UpdateCalendarEventStatusSchema = z
  .object({ status: CalendarEventStatusSchema })
  .strict();

export const CalendarEventListQuerySchema = z
  .object({
    calendarId: IdSchema.optional(),
    contactId: IdSchema.optional(),
    opportunityId: IdSchema.optional(),
    advisorMemberId: IdSchema.optional(),
    status: CalendarEventStatusSchema.optional(),
    type: CalendarEventTypeSchema.optional(),
    from: TimestampSchema.optional(),
    to: TimestampSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      Date.parse(value.from) < Date.parse(value.to),
    "from must precede to",
  );

export const CalendarEventHistorySchema = z
  .object({
    id: IdSchema,
    eventId: IdSchema,
    eventType: z.enum(["CREATED", "UPDATED", "RESCHEDULED", "STATUS_CHANGED"]),
    actorType: z.enum(["MEMBER", "PUBLIC", "SYSTEM"]),
    actorMemberId: NullableIdSchema,
    previousValue: z.string().max(4_000).nullable(),
    nextValue: z.string().max(4_000).nullable(),
    createdAt: TimestampSchema,
  })
  .strict();

export const CalendarAvailabilityQuerySchema = z
  .object({
    calendarId: IdSchema,
    advisorMemberId: IdSchema.optional(),
    from: TimestampSchema,
    to: TimestampSchema,
    durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  })
  .strict()
  .refine((value) => Date.parse(value.from) < Date.parse(value.to), "from must precede to")
  .refine(
    (value) => Date.parse(value.to) - Date.parse(value.from) <= 31 * 24 * 60 * 60 * 1_000,
    "Availability range cannot exceed 31 days",
  );

export const PublicCalendarAvailabilityQuerySchema = z
  .object({
    advisorMemberId: IdSchema.optional(),
    from: TimestampSchema,
    to: TimestampSchema,
    durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  })
  .strict()
  .refine((value) => Date.parse(value.from) < Date.parse(value.to), "from must precede to")
  .refine(
    (value) => Date.parse(value.to) - Date.parse(value.from) <= 31 * 24 * 60 * 60 * 1_000,
    "Availability range cannot exceed 31 days",
  );

export const AvailableCalendarSlotSchema = z
  .object({
    calendarId: IdSchema,
    advisorMemberId: IdSchema,
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
    timeZone: TimeZoneSchema,
  })
  .strict();

export const PublicCalendarSchema = CalendarDefinitionSchema.pick({
  name: true,
  serviceName: true,
  location: true,
  timeZone: true,
  slotDurationMinutes: true,
  bookingSlug: true,
});

export const PublicCalendarAvailabilityResponseSchema = z
  .object({
    data: z.object({
      calendar: PublicCalendarSchema,
      slots: z.array(AvailableCalendarSlotSchema).max(1_000),
    }),
  })
  .strict();

export const PublicCalendarBookingSchema = z
  .object({
    advisorMemberId: IdSchema,
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
    guestName: z.string().trim().min(1).max(160),
    guestEmail: z.string().trim().email().max(320),
    notes: z.string().trim().max(4_000).default(""),
  })
  .strict()
  .refine(
    (value) => Date.parse(value.startsAt) < Date.parse(value.endsAt),
    "startsAt must precede endsAt",
  );

export const CalendarResponseSchema = z.object({ data: CalendarDefinitionSchema }).strict();
export const CalendarListResponseSchema = z
  .object({ data: z.array(CalendarDefinitionSchema) })
  .strict();
export const CalendarConfigurationResponseSchema = z
  .object({ data: CalendarConfigurationSchema })
  .strict();
export const CalendarEventResponseSchema = z.object({ data: CalendarEventSchema }).strict();
export const CalendarEventListResponseSchema = z
  .object({ data: z.array(CalendarEventSchema) })
  .strict();
export const CalendarEventHistoryListResponseSchema = z
  .object({ data: z.array(CalendarEventHistorySchema) })
  .strict();
export const CalendarAvailabilityResponseSchema = z
  .object({ data: z.array(AvailableCalendarSlotSchema) })
  .strict();

export type CalendarDefinition = z.infer<typeof CalendarDefinitionSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type CalendarEventStatus = z.infer<typeof CalendarEventStatusSchema>;
export type CalendarEventType = z.infer<typeof CalendarEventTypeSchema>;
export type CalendarEventOrigin = z.infer<typeof CalendarEventOriginSchema>;
export type CalendarEventListQuery = z.infer<typeof CalendarEventListQuerySchema>;
export type CalendarAvailabilityRule = z.infer<typeof AvailabilityRuleSchema>;
export type CalendarAvailabilityException = z.infer<typeof AvailabilityExceptionSchema>;
export type AvailableCalendarSlot = z.infer<typeof AvailableCalendarSlotSchema>;
export type PublicCalendarBooking = z.infer<typeof PublicCalendarBookingSchema>;
