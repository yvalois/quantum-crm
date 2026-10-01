import type {
  CalendarAvailabilityExceptionRecord,
  CalendarAvailabilityRuleRecord,
  CalendarDefinitionRecord,
  CalendarEventHistoryRecord,
  CalendarEventRecord,
  CalendarRepository,
  CalendarSchedulingSnapshot,
  CommercialActor,
} from "@quantum-crm/domain";
import { CalendarSlotConflictError } from "@quantum-crm/domain";
import type { PoolClient } from "pg";

import { CommercialIdempotencyConflictError } from "./commercial-postgres-database.js";
import { DatabaseUnavailableError, type PostgresPool } from "./postgres-database.js";

interface CalendarRow {
  readonly id: string;
  readonly name: string;
  readonly service_name: string;
  readonly location: string | null;
  readonly time_zone: string;
  readonly slot_duration_minutes: number;
  readonly buffer_before_minutes: number;
  readonly buffer_after_minutes: number;
  readonly booking_slug: string;
  readonly active: boolean;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface AvailabilityRuleRow {
  readonly id: string;
  readonly calendar_id: string;
  readonly advisor_member_id: string;
  readonly weekday: number;
  readonly start_minute: number;
  readonly end_minute: number;
}

interface AvailabilityExceptionRow {
  readonly id: string;
  readonly calendar_id: string;
  readonly advisor_member_id: string;
  readonly date: Date | string;
  readonly available: boolean;
  readonly start_minute: number | null;
  readonly end_minute: number | null;
  readonly reason: string | null;
}

interface EventRow {
  readonly id: string;
  readonly calendar_id: string;
  readonly contact_id: string | null;
  readonly opportunity_id: string | null;
  readonly advisor_member_id: string;
  readonly created_by_member_id: string | null;
  readonly guest_name: string | null;
  readonly guest_email: string | null;
  readonly type: string;
  readonly status: string;
  readonly origin: string;
  readonly title: string;
  readonly description: string;
  readonly location: string | null;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly time_zone: string;
  readonly version: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface HistoryRow {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: string;
  readonly actor_type: string;
  readonly actor_member_id: string | null;
  readonly previous_value: string | null;
  readonly next_value: string | null;
  readonly created_at: Date;
}

const calendarSelection = `id::text, name, service_name, location, time_zone, slot_duration_minutes, buffer_before_minutes, buffer_after_minutes, booking_slug, active, version::text, created_at, updated_at`;
const eventSelection = `id::text, calendar_id::text, contact_id::text, opportunity_id::text, advisor_member_id::text, created_by_member_id::text, guest_name, guest_email::text, type, status, origin, title, description, location, starts_at, ends_at, time_zone, version::text, created_at, updated_at`;

async function typedQuery<Row>(
  client: Pick<PostgresPool, "query">,
  text: string,
  values?: unknown[],
): Promise<{ readonly rows: readonly Row[] }> {
  return (await client.query(text, values)) as { readonly rows: readonly Row[] };
}

function calendarFromRow(row: CalendarRow): CalendarDefinitionRecord {
  return Object.freeze({
    id: row.id,
    name: row.name,
    serviceName: row.service_name,
    location: row.location,
    timeZone: row.time_zone,
    slotDurationMinutes: row.slot_duration_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    bookingSlug: row.booking_slug,
    active: row.active,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function ruleFromRow(row: AvailabilityRuleRow): CalendarAvailabilityRuleRecord {
  return Object.freeze({
    id: row.id,
    calendarId: row.calendar_id,
    advisorMemberId: row.advisor_member_id,
    weekday: row.weekday,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
  });
}

function dateOnly(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function exceptionFromRow(row: AvailabilityExceptionRow): CalendarAvailabilityExceptionRecord {
  return Object.freeze({
    id: row.id,
    calendarId: row.calendar_id,
    advisorMemberId: row.advisor_member_id,
    date: dateOnly(row.date),
    available: row.available,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    reason: row.reason,
  });
}

function eventFromRow(row: EventRow): CalendarEventRecord {
  const type = row.type.toUpperCase() as CalendarEventRecord["type"];
  const status = row.status.toUpperCase() as CalendarEventRecord["status"];
  const origin = row.origin.toUpperCase() as CalendarEventRecord["origin"];
  if (!["APPOINTMENT", "MEETING", "EVENT"].includes(type)) throw new DatabaseUnavailableError();
  if (!["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"].includes(status))
    throw new DatabaseUnavailableError();
  if (!["MANUAL", "AUTOMATION", "AGENT", "BOOKING"].includes(origin))
    throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    calendarId: row.calendar_id,
    contactId: row.contact_id,
    opportunityId: row.opportunity_id,
    advisorMemberId: row.advisor_member_id,
    createdByMemberId: row.created_by_member_id,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    type,
    status,
    origin,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    timeZone: row.time_zone,
    version: BigInt(row.version),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

function historyFromRow(row: HistoryRow): CalendarEventHistoryRecord {
  const eventType = row.event_type.toUpperCase() as CalendarEventHistoryRecord["eventType"];
  const actorType = row.actor_type.toUpperCase() as CalendarEventHistoryRecord["actorType"];
  if (!["CREATED", "UPDATED", "RESCHEDULED", "STATUS_CHANGED"].includes(eventType))
    throw new DatabaseUnavailableError();
  if (!["MEMBER", "PUBLIC", "SYSTEM"].includes(actorType)) throw new DatabaseUnavailableError();
  return Object.freeze({
    id: row.id,
    eventId: row.event_id,
    eventType,
    actorType,
    actorMemberId: row.actor_member_id,
    previousValue: row.previous_value,
    nextValue: row.next_value,
    createdAt: new Date(row.created_at),
  });
}

function access(
  actor: CommercialActor,
  memberPlaceholder: number,
): {
  readonly sql: string;
  readonly params: readonly string[];
} {
  if (actor.scope === "PROFILE") return { sql: "TRUE", params: [] };
  if (actor.scope === "TEAM")
    return {
      sql: `EXISTS (
        SELECT 1 FROM iam.team_members viewer_team
        JOIN iam.team_members event_team ON event_team.team_id = viewer_team.team_id
        WHERE viewer_team.member_id = $${memberPlaceholder}::uuid
          AND event_team.member_id IN (event.advisor_member_id, event.created_by_member_id)
      )`,
      params: [actor.memberId],
    };
  return {
    sql: `(event.advisor_member_id = $${memberPlaceholder}::uuid OR event.created_by_member_id = $${memberPlaceholder}::uuid)`,
    params: [actor.memberId],
  };
}

function databaseError(error: unknown): never {
  if (
    error instanceof CommercialIdempotencyConflictError ||
    error instanceof CalendarSlotConflictError
  )
    throw error;
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01")
    throw new CalendarSlotConflictError();
  throw new DatabaseUnavailableError();
}

async function lockCommand(
  client: PoolClient,
  principalKey: string,
  command: string,
  idempotencyKey: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${principalKey}:${command}:${idempotencyKey}`,
  ]);
}

async function replay<T>(
  client: PoolClient,
  principalKey: string,
  command: string,
  idempotencyKey: string,
  payloadHash: string,
): Promise<T | null> {
  const result = await client.query<{ readonly payload_hash: string; readonly response: T }>(
    `SELECT payload_hash, response
       FROM calendar.command_idempotency
      WHERE principal_key = $1 AND command = $2 AND idempotency_key = $3
      FOR UPDATE`,
    [principalKey, command, idempotencyKey],
  );
  const found = result.rows[0];
  if (!found) return null;
  if (found.payload_hash !== payloadHash) throw new CommercialIdempotencyConflictError();
  return found.response;
}

async function remember(
  client: PoolClient,
  principalKey: string,
  command: string,
  idempotencyKey: string,
  payloadHash: string,
  response: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO calendar.command_idempotency
       (principal_key, command, idempotency_key, payload_hash, response)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [principalKey, command, idempotencyKey, payloadHash, JSON.stringify(response)],
  );
}

async function configurationRows(client: Pick<PostgresPool, "query">, calendarId: string) {
  const [calendarResult, ruleResult, exceptionResult] = await Promise.all([
    typedQuery<CalendarRow>(
      client,
      `SELECT ${calendarSelection} FROM calendar.calendars WHERE id = $1::uuid`,
      [calendarId],
    ),
    typedQuery<AvailabilityRuleRow>(
      client,
      `SELECT id::text, calendar_id::text, advisor_member_id::text, weekday, start_minute, end_minute
         FROM calendar.availability_rules WHERE calendar_id = $1::uuid
        ORDER BY advisor_member_id, weekday, start_minute`,
      [calendarId],
    ),
    typedQuery<AvailabilityExceptionRow>(
      client,
      `SELECT id::text, calendar_id::text, advisor_member_id::text, date, available, start_minute, end_minute, reason
         FROM calendar.availability_exceptions WHERE calendar_id = $1::uuid
        ORDER BY date, advisor_member_id, start_minute NULLS FIRST`,
      [calendarId],
    ),
  ]);
  const calendarRow = calendarResult.rows[0];
  if (!calendarRow) return null;
  return Object.freeze({
    calendar: calendarFromRow(calendarRow),
    rules: Object.freeze(ruleResult.rows.map(ruleFromRow)),
    exceptions: Object.freeze(exceptionResult.rows.map(exceptionFromRow)),
  });
}

async function lockSlot(
  client: PoolClient,
  event: Pick<CalendarEventRecord, "id" | "calendarId" | "advisorMemberId" | "startsAt" | "endsAt">,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `calendar-slot:${event.calendarId}:${event.advisorMemberId}`,
  ]);
  const result = await client.query<{ readonly id: string }>(
    `SELECT event.id::text
       FROM calendar.events AS event
       JOIN calendar.calendars AS definition ON definition.id = event.calendar_id
      WHERE event.calendar_id = $1::uuid
        AND event.advisor_member_id = $2::uuid
        AND event.id <> $3::uuid
        AND event.status IN ('pending', 'confirmed')
        AND tstzrange(
              event.starts_at - make_interval(mins => definition.buffer_before_minutes),
              event.ends_at + make_interval(mins => definition.buffer_after_minutes),
              '[)'
            ) && tstzrange(
              $4::timestamptz - make_interval(mins => definition.buffer_before_minutes),
              $5::timestamptz + make_interval(mins => definition.buffer_after_minutes),
              '[)'
            )
      LIMIT 1`,
    [event.calendarId, event.advisorMemberId, event.id, event.startsAt, event.endsAt],
  );
  if (result.rows[0]) throw new CalendarSlotConflictError();
}

async function scheduleEffects(
  client: PoolClient,
  event: CalendarEventRecord,
  eventType: string,
  now: Date,
): Promise<void> {
  await client.query(
    `UPDATE calendar.reminders
        SET status = 'cancelled', updated_at = $2
      WHERE event_id = $1::uuid AND status = 'pending'`,
    [event.id, now],
  );
  if (event.status === "PENDING" || event.status === "CONFIRMED") {
    await client.query(
      `INSERT INTO calendar.reminders
         (event_id, audience, scheduled_at, status, created_at, updated_at)
       VALUES
         ($1::uuid, 'client', GREATEST($2::timestamptz, $3::timestamptz - interval '24 hours'), 'pending', $2, $2),
         ($1::uuid, 'advisor', GREATEST($2::timestamptz, $3::timestamptz - interval '1 hour'), 'pending', $2, $2)`,
      [event.id, now, event.startsAt],
    );
  }
  await client.query(
    `INSERT INTO calendar.outbox
       (event_id, event_type, payload, status, occurred_at, created_at, updated_at)
     VALUES ($1::uuid, $2, $3::jsonb, 'pending', $4, $4, $4)`,
    [
      event.id,
      eventType,
      JSON.stringify({
        eventId: event.id,
        calendarId: event.calendarId,
        advisorMemberId: event.advisorMemberId,
        contactId: event.contactId,
        opportunityId: event.opportunityId,
        status: event.status,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        version: event.version.toString(),
      }),
      now,
    ],
  );
}

export function createCalendarPostgresRepository(pool: PostgresPool): CalendarRepository {
  return Object.freeze<CalendarRepository>({
    listCalendars: async () => {
      try {
        const result = await typedQuery<CalendarRow>(
          pool,
          `SELECT ${calendarSelection} FROM calendar.calendars ORDER BY active DESC, name, id LIMIT 500`,
        );
        return Object.freeze(result.rows.map(calendarFromRow));
      } catch (error) {
        return databaseError(error);
      }
    },
    findCalendar: async (id) => {
      try {
        const result = await typedQuery<CalendarRow>(
          pool,
          `SELECT ${calendarSelection} FROM calendar.calendars WHERE id = $1::uuid`,
          [id],
        );
        return result.rows[0] ? calendarFromRow(result.rows[0]) : null;
      } catch (error) {
        return databaseError(error);
      }
    },
    findCalendarBySlug: async (slug) => {
      try {
        const result = await typedQuery<CalendarRow>(
          pool,
          `SELECT ${calendarSelection} FROM calendar.calendars WHERE booking_slug = $1 AND active = true`,
          [slug],
        );
        return result.rows[0] ? calendarFromRow(result.rows[0]) : null;
      } catch (error) {
        return databaseError(error);
      }
    },
    createCalendar: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principalKey = `member:${input.actorMemberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(client, principalKey, "calendar.create", input.idempotencyKey);
        const previous = await replay<CalendarRow>(
          client,
          principalKey,
          "calendar.create",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return calendarFromRow(previous);
        }
        const result = await client.query<CalendarRow>(
          `INSERT INTO calendar.calendars
             (id, name, service_name, location, time_zone, slot_duration_minutes,
              buffer_before_minutes, buffer_after_minutes, booking_slug, active,
              version, created_at, updated_at)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, true, 1, $10, $10)
           RETURNING ${calendarSelection}`,
          [
            input.calendar.id,
            input.calendar.name,
            input.calendar.serviceName,
            input.calendar.location,
            input.calendar.timeZone,
            input.calendar.slotDurationMinutes,
            input.calendar.bufferBeforeMinutes,
            input.calendar.bufferAfterMinutes,
            input.calendar.bookingSlug,
            input.calendar.createdAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        await remember(
          client,
          principalKey,
          "calendar.create",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return calendarFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return databaseError(error);
      } finally {
        client?.release();
      }
    },
    updateCalendar: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principalKey = `member:${input.actorMemberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(client, principalKey, "calendar.update", input.idempotencyKey);
        const previous = await replay<CalendarRow>(
          client,
          principalKey,
          "calendar.update",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return calendarFromRow(previous);
        }
        const patch = input.patch;
        const result = await client.query<CalendarRow>(
          `UPDATE calendar.calendars
              SET name = CASE WHEN $3::boolean THEN $4 ELSE name END,
                  service_name = CASE WHEN $5::boolean THEN $6 ELSE service_name END,
                  location = CASE WHEN $7::boolean THEN $8 ELSE location END,
                  time_zone = CASE WHEN $9::boolean THEN $10 ELSE time_zone END,
                  slot_duration_minutes = CASE WHEN $11::boolean THEN $12 ELSE slot_duration_minutes END,
                  buffer_before_minutes = CASE WHEN $13::boolean THEN $14 ELSE buffer_before_minutes END,
                  buffer_after_minutes = CASE WHEN $15::boolean THEN $16 ELSE buffer_after_minutes END,
                  active = CASE WHEN $17::boolean THEN $18 ELSE active END,
                  version = version + 1,
                  updated_at = $19
            WHERE id = $1::uuid AND version = $2::bigint
            RETURNING ${calendarSelection}`,
          [
            input.id,
            input.expectedVersion.toString(),
            patch.name !== undefined,
            patch.name ?? null,
            patch.serviceName !== undefined,
            patch.serviceName ?? null,
            patch.location !== undefined,
            patch.location ?? null,
            patch.timeZone !== undefined,
            patch.timeZone ?? null,
            patch.slotDurationMinutes !== undefined,
            patch.slotDurationMinutes ?? null,
            patch.bufferBeforeMinutes !== undefined,
            patch.bufferBeforeMinutes ?? null,
            patch.bufferAfterMinutes !== undefined,
            patch.bufferAfterMinutes ?? null,
            patch.active !== undefined,
            patch.active ?? null,
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        await remember(
          client,
          principalKey,
          "calendar.update",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return calendarFromRow(row);
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return databaseError(error);
      } finally {
        client?.release();
      }
    },
    configuration: async (calendarId) => {
      try {
        return await configurationRows(pool, calendarId);
      } catch (error) {
        return databaseError(error);
      }
    },
    replaceAvailability: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principalKey = `member:${input.actorMemberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(
          client,
          principalKey,
          "calendar.availability.replace",
          input.idempotencyKey,
        );
        const previous = await replay<unknown>(
          client,
          principalKey,
          "calendar.availability.replace",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          const current = await configurationRows(client, input.calendarId);
          await client.query("COMMIT");
          return current;
        }
        const locked = await client.query<{ readonly id: string }>(
          `SELECT id::text FROM calendar.calendars WHERE id = $1::uuid FOR UPDATE`,
          [input.calendarId],
        );
        if (!locked.rows[0]) {
          await client.query("COMMIT");
          return null;
        }
        await client.query(`DELETE FROM calendar.availability_rules WHERE calendar_id = $1::uuid`, [
          input.calendarId,
        ]);
        await client.query(
          `DELETE FROM calendar.availability_exceptions WHERE calendar_id = $1::uuid`,
          [input.calendarId],
        );
        for (const rule of input.rules)
          await client.query(
            `INSERT INTO calendar.availability_rules
               (id, calendar_id, advisor_member_id, weekday, start_minute, end_minute)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
            [
              rule.id,
              rule.calendarId,
              rule.advisorMemberId,
              rule.weekday,
              rule.startMinute,
              rule.endMinute,
            ],
          );
        for (const entry of input.exceptions)
          await client.query(
            `INSERT INTO calendar.availability_exceptions
               (id, calendar_id, advisor_member_id, date, available, start_minute, end_minute, reason)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::date, $5, $6, $7, $8)`,
            [
              entry.id,
              entry.calendarId,
              entry.advisorMemberId,
              entry.date,
              entry.available,
              entry.startMinute,
              entry.endMinute,
              entry.reason,
            ],
          );
        await remember(
          client,
          principalKey,
          "calendar.availability.replace",
          input.idempotencyKey,
          input.payloadHash,
          { calendarId: input.calendarId },
        );
        const current = await configurationRows(client, input.calendarId);
        await client.query("COMMIT");
        return current;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return databaseError(error);
      } finally {
        client?.release();
      }
    },
    schedulingSnapshot: async (calendarId, from, to, advisorMemberId) => {
      try {
        const configuration = await configurationRows(pool, calendarId);
        if (!configuration?.calendar.active) return null;
        const params: unknown[] = [calendarId, from, to];
        let advisor = "";
        if (advisorMemberId) {
          params.push(advisorMemberId);
          advisor = `AND advisor_member_id = $4::uuid`;
        }
        const busy = await typedQuery<EventRow>(
          pool,
          `SELECT ${eventSelection}
             FROM calendar.events
            WHERE calendar_id = $1::uuid
              AND status IN ('pending', 'confirmed')
              AND starts_at < $3::timestamptz
              AND ends_at > $2::timestamptz
              ${advisor}
            ORDER BY starts_at, id
            LIMIT 5000`,
          params,
        );
        return Object.freeze<CalendarSchedulingSnapshot>({
          ...configuration,
          busyEvents: Object.freeze(busy.rows.map(eventFromRow)),
        });
      } catch (error) {
        return databaseError(error);
      }
    },
    listEvents: async (actor, filters) => {
      try {
        const clauses: string[] = [];
        const params: unknown[] = [];
        const add = (sql: string, value: unknown): void => {
          params.push(value);
          clauses.push(sql.replace("?", `$${params.length}`));
        };
        if (filters.calendarId) add("event.calendar_id = ?::uuid", filters.calendarId);
        if (filters.contactId) add("event.contact_id = ?::uuid", filters.contactId);
        if (filters.opportunityId) add("event.opportunity_id = ?::uuid", filters.opportunityId);
        if (filters.advisorMemberId)
          add("event.advisor_member_id = ?::uuid", filters.advisorMemberId);
        if (filters.status) add("event.status = ?", filters.status.toLowerCase());
        if (filters.type) add("event.type = ?", filters.type.toLowerCase());
        if (filters.from) add("event.ends_at > ?::timestamptz", filters.from);
        if (filters.to) add("event.starts_at < ?::timestamptz", filters.to);
        const visible = access(actor, params.length + 1);
        params.push(...visible.params);
        clauses.push(visible.sql);
        const result = await typedQuery<EventRow>(
          pool,
          `SELECT ${eventSelection}
             FROM calendar.events AS event
            WHERE ${clauses.join(" AND ") || "TRUE"}
            ORDER BY event.starts_at ASC, event.id ASC
            LIMIT 1000`,
          params,
        );
        return Object.freeze(result.rows.map(eventFromRow));
      } catch (error) {
        return databaseError(error);
      }
    },
    findEvent: async (actor, id) => {
      try {
        const visible = access(actor, 2);
        const result = await typedQuery<EventRow>(
          pool,
          `SELECT ${eventSelection} FROM calendar.events AS event
            WHERE event.id = $1::uuid AND ${visible.sql}`,
          [id, ...visible.params],
        );
        return result.rows[0] ? eventFromRow(result.rows[0]) : null;
      } catch (error) {
        return databaseError(error);
      }
    },
    createEvent: async (input) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(
          client,
          input.principalKey,
          "calendar.event.create",
          input.idempotencyKey,
        );
        const previous = await replay<EventRow>(
          client,
          input.principalKey,
          "calendar.event.create",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return eventFromRow(previous);
        }
        await lockSlot(client, input.event);
        const result = await client.query<EventRow>(
          `INSERT INTO calendar.events
             (id, calendar_id, contact_id, opportunity_id, advisor_member_id,
              created_by_member_id, guest_name, guest_email, type, status, origin,
              title, description, location, starts_at, ends_at, time_zone, version,
              created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
                   $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1, $18, $18)
           RETURNING ${eventSelection}`,
          [
            input.event.id,
            input.event.calendarId,
            input.event.contactId,
            input.event.opportunityId,
            input.event.advisorMemberId,
            input.event.createdByMemberId,
            input.event.guestName,
            input.event.guestEmail,
            input.event.type.toLowerCase(),
            input.event.status.toLowerCase(),
            input.event.origin.toLowerCase(),
            input.event.title,
            input.event.description,
            input.event.location,
            input.event.startsAt,
            input.event.endsAt,
            input.event.timeZone,
            input.event.createdAt,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new DatabaseUnavailableError();
        const event = eventFromRow(row);
        await client.query(
          `INSERT INTO calendar.event_history
             (event_id, event_type, actor_type, actor_member_id, previous_value, next_value, created_at)
           VALUES ($1::uuid, 'created', $2, $3::uuid, NULL, $4, $5)`,
          [event.id, input.actorType.toLowerCase(), input.actorMemberId, event.status, input.now],
        );
        await scheduleEffects(client, event, "calendar.event.created.v1", input.now);
        await remember(
          client,
          input.principalKey,
          "calendar.event.create",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return event;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return databaseError(error);
      } finally {
        client?.release();
      }
    },
    updateEvent: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principalKey = `member:${input.actor.memberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(client, principalKey, "calendar.event.update", input.idempotencyKey);
        const previous = await replay<EventRow>(
          client,
          principalKey,
          "calendar.event.update",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return eventFromRow(previous);
        }
        const visible = access(input.actor, 3);
        const beforeResult = await client.query<EventRow>(
          `SELECT ${eventSelection} FROM calendar.events AS event
            WHERE event.id = $1::uuid AND event.version = $2::bigint AND ${visible.sql}
            FOR UPDATE`,
          [input.id, input.expectedVersion.toString(), ...visible.params],
        );
        const beforeRow = beforeResult.rows[0];
        if (!beforeRow) {
          await client.query("COMMIT");
          return null;
        }
        const before = eventFromRow(beforeRow);
        const candidate = Object.freeze({
          ...before,
          ...input.patch,
          advisorMemberId: input.patch.advisorMemberId ?? before.advisorMemberId,
          startsAt: input.patch.startsAt ?? before.startsAt,
          endsAt: input.patch.endsAt ?? before.endsAt,
        });
        if (before.status === "PENDING" || before.status === "CONFIRMED")
          await lockSlot(client, candidate);
        const patch = input.patch;
        const result = await client.query<EventRow>(
          `UPDATE calendar.events
              SET contact_id = CASE WHEN $3::boolean THEN $4::uuid ELSE contact_id END,
                  opportunity_id = CASE WHEN $5::boolean THEN $6::uuid ELSE opportunity_id END,
                  advisor_member_id = CASE WHEN $7::boolean THEN $8::uuid ELSE advisor_member_id END,
                  type = CASE WHEN $9::boolean THEN $10 ELSE type END,
                  title = CASE WHEN $11::boolean THEN $12 ELSE title END,
                  description = CASE WHEN $13::boolean THEN $14 ELSE description END,
                  location = CASE WHEN $15::boolean THEN $16 ELSE location END,
                  starts_at = CASE WHEN $17::boolean THEN $18::timestamptz ELSE starts_at END,
                  ends_at = CASE WHEN $19::boolean THEN $20::timestamptz ELSE ends_at END,
                  time_zone = CASE WHEN $21::boolean THEN $22 ELSE time_zone END,
                  version = version + 1,
                  updated_at = $23
            WHERE id = $1::uuid AND version = $2::bigint
            RETURNING ${eventSelection}`,
          [
            input.id,
            input.expectedVersion.toString(),
            patch.contactId !== undefined,
            patch.contactId ?? null,
            patch.opportunityId !== undefined,
            patch.opportunityId ?? null,
            patch.advisorMemberId !== undefined,
            patch.advisorMemberId ?? null,
            patch.type !== undefined,
            patch.type?.toLowerCase() ?? null,
            patch.title !== undefined,
            patch.title ?? null,
            patch.description !== undefined,
            patch.description ?? null,
            patch.location !== undefined,
            patch.location ?? null,
            patch.startsAt !== undefined,
            patch.startsAt ?? null,
            patch.endsAt !== undefined,
            patch.endsAt ?? null,
            patch.timeZone !== undefined,
            patch.timeZone ?? null,
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const event = eventFromRow(row);
        const rescheduled =
          before.startsAt.getTime() !== event.startsAt.getTime() ||
          before.endsAt.getTime() !== event.endsAt.getTime() ||
          before.advisorMemberId !== event.advisorMemberId;
        await client.query(
          `INSERT INTO calendar.event_history
             (event_id, event_type, actor_type, actor_member_id, previous_value, next_value, created_at)
           VALUES ($1::uuid, $2, 'member', $3::uuid, $4, $5, $6)`,
          [
            event.id,
            rescheduled ? "rescheduled" : "updated",
            input.actor.memberId,
            JSON.stringify({
              startsAt: before.startsAt,
              endsAt: before.endsAt,
              advisorMemberId: before.advisorMemberId,
            }),
            JSON.stringify({
              startsAt: event.startsAt,
              endsAt: event.endsAt,
              advisorMemberId: event.advisorMemberId,
            }),
            input.now,
          ],
        );
        await scheduleEffects(
          client,
          event,
          rescheduled ? "calendar.event.rescheduled.v1" : "calendar.event.updated.v1",
          input.now,
        );
        await remember(
          client,
          principalKey,
          "calendar.event.update",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return event;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return databaseError(error);
      } finally {
        client?.release();
      }
    },
    updateEventStatus: async (input) => {
      let client: PoolClient | undefined;
      try {
        const principalKey = `member:${input.actor.memberId}`;
        client = await pool.connect();
        await client.query("BEGIN");
        await lockCommand(client, principalKey, "calendar.event.status", input.idempotencyKey);
        const previous = await replay<EventRow>(
          client,
          principalKey,
          "calendar.event.status",
          input.idempotencyKey,
          input.payloadHash,
        );
        if (previous) {
          await client.query("COMMIT");
          return eventFromRow(previous);
        }
        const visible = access(input.actor, 4);
        const nowParameter = 4 + visible.params.length;
        const result = await client.query<EventRow>(
          `UPDATE calendar.events AS event
              SET status = $3, version = version + 1, updated_at = $${nowParameter}
            WHERE event.id = $1::uuid AND event.version = $2::bigint AND ${visible.sql}
            RETURNING ${eventSelection}`,
          [
            input.id,
            input.expectedVersion.toString(),
            input.status.toLowerCase(),
            ...visible.params,
            input.now,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          await client.query("COMMIT");
          return null;
        }
        const event = eventFromRow(row);
        await client.query(
          `INSERT INTO calendar.event_history
             (event_id, event_type, actor_type, actor_member_id, previous_value, next_value, created_at)
           VALUES ($1::uuid, 'status_changed', 'member', $2::uuid, NULL, $3, $4)`,
          [event.id, input.actor.memberId, input.status, input.now],
        );
        await scheduleEffects(
          client,
          event,
          `calendar.event.${input.status.toLowerCase()}.v1`,
          input.now,
        );
        await remember(
          client,
          principalKey,
          "calendar.event.status",
          input.idempotencyKey,
          input.payloadHash,
          row,
        );
        await client.query("COMMIT");
        return event;
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => undefined);
        return databaseError(error);
      } finally {
        client?.release();
      }
    },
    history: async (actor, eventId) => {
      try {
        const visible = access(actor, 2);
        const result = await typedQuery<HistoryRow>(
          pool,
          `SELECT history.id::text, history.event_id::text, history.event_type,
                  history.actor_type, history.actor_member_id::text,
                  history.previous_value, history.next_value, history.created_at
             FROM calendar.event_history AS history
             JOIN calendar.events AS event ON event.id = history.event_id
            WHERE event.id = $1::uuid AND ${visible.sql}
            ORDER BY history.created_at DESC, history.id DESC
            LIMIT 500`,
          [eventId, ...visible.params],
        );
        return Object.freeze(result.rows.map(historyFromRow));
      } catch (error) {
        return databaseError(error);
      }
    },
  });
}
