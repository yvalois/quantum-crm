-- CAL-01..18: calendars, availability, reservations, reminders and durable events.
ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate',
    'iam:members:export', 'iam:members:roles', 'iam:teams:read', 'iam:teams:create', 'iam:teams:update',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update', 'crm:contacts:delete', 'crm:contacts:export',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:update', 'crm:sales:delete', 'crm:sales:export',
    'crm:sales:configure', 'crm:sales:move', 'crm:tasks:read', 'crm:tasks:create', 'crm:tasks:update',
    'crm:tasks:delete', 'crm:tasks:export', 'crm:calendar:read', 'crm:calendar:create',
    'crm:calendar:update', 'crm:calendar:configure', 'crm:automations:read', 'crm:automations:execute',
    'crm:automations:configure', 'crm:conversations:read', 'crm:conversations:reply',
    'crm:conversations:assign', 'crm:conversations:control-agent', 'crm:conversations:configure'
  )
);

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA calendar;

CREATE TABLE calendar.calendars (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL,
  service_name varchar(160) NOT NULL,
  location varchar(500),
  time_zone varchar(80) NOT NULL,
  slot_duration_minutes integer NOT NULL DEFAULT 30,
  buffer_before_minutes integer NOT NULL DEFAULT 0,
  buffer_after_minutes integer NOT NULL DEFAULT 0,
  booking_slug varchar(80) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT calendar_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT calendar_service_name_check CHECK (length(btrim(service_name)) BETWEEN 1 AND 160),
  CONSTRAINT calendar_location_check CHECK (location IS NULL OR length(btrim(location)) BETWEEN 1 AND 500),
  CONSTRAINT calendar_time_zone_check CHECK (length(btrim(time_zone)) BETWEEN 1 AND 80),
  CONSTRAINT calendar_slot_duration_check CHECK (slot_duration_minutes BETWEEN 5 AND 480),
  CONSTRAINT calendar_buffer_before_check CHECK (buffer_before_minutes BETWEEN 0 AND 240),
  CONSTRAINT calendar_buffer_after_check CHECK (buffer_after_minutes BETWEEN 0 AND 240),
  CONSTRAINT calendar_booking_slug_check CHECK (booking_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{8}$'),
  CONSTRAINT calendar_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX calendar_name_unique ON calendar.calendars(lower(name));
CREATE UNIQUE INDEX calendar_booking_slug_unique ON calendar.calendars(booking_slug);
CREATE INDEX calendar_active_name_idx ON calendar.calendars(active DESC, name, id);

CREATE TABLE calendar.availability_rules (
  id uuid PRIMARY KEY,
  calendar_id uuid NOT NULL REFERENCES calendar.calendars(id) ON DELETE RESTRICT,
  advisor_member_id uuid NOT NULL,
  weekday smallint NOT NULL,
  start_minute smallint NOT NULL,
  end_minute smallint NOT NULL,
  CONSTRAINT calendar_availability_weekday_check CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT calendar_availability_minutes_check CHECK (
    start_minute BETWEEN 0 AND 1439 AND end_minute BETWEEN 1 AND 1440 AND start_minute < end_minute
  )
);
CREATE INDEX calendar_availability_lookup_idx
  ON calendar.availability_rules(calendar_id, advisor_member_id, weekday, start_minute, end_minute);

CREATE TABLE calendar.availability_exceptions (
  id uuid PRIMARY KEY,
  calendar_id uuid NOT NULL REFERENCES calendar.calendars(id) ON DELETE RESTRICT,
  advisor_member_id uuid NOT NULL,
  date date NOT NULL,
  available boolean NOT NULL,
  start_minute smallint,
  end_minute smallint,
  reason varchar(240),
  CONSTRAINT calendar_exception_range_check CHECK (
    (available AND start_minute BETWEEN 0 AND 1439 AND end_minute BETWEEN 1 AND 1440 AND start_minute < end_minute)
    OR (NOT available AND start_minute IS NULL AND end_minute IS NULL)
  ),
  CONSTRAINT calendar_exception_reason_check CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 240)
);
CREATE INDEX calendar_exception_lookup_idx
  ON calendar.availability_exceptions(calendar_id, advisor_member_id, date);

CREATE TABLE calendar.events (
  id uuid PRIMARY KEY,
  calendar_id uuid NOT NULL REFERENCES calendar.calendars(id) ON DELETE RESTRICT,
  contact_id uuid,
  opportunity_id uuid,
  advisor_member_id uuid NOT NULL,
  created_by_member_id uuid,
  guest_name varchar(160),
  guest_email citext,
  type varchar(16) NOT NULL,
  status varchar(16) NOT NULL,
  origin varchar(16) NOT NULL,
  title varchar(200) NOT NULL,
  description varchar(4000) NOT NULL DEFAULT '',
  location varchar(500),
  starts_at timestamptz(6) NOT NULL,
  ends_at timestamptz(6) NOT NULL,
  time_zone varchar(80) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT calendar_event_type_check CHECK (type IN ('appointment', 'meeting', 'event')),
  CONSTRAINT calendar_event_status_check CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  CONSTRAINT calendar_event_origin_check CHECK (origin IN ('manual', 'automation', 'agent', 'booking')),
  CONSTRAINT calendar_event_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT calendar_event_description_check CHECK (length(description) <= 4000),
  CONSTRAINT calendar_event_location_check CHECK (location IS NULL OR length(btrim(location)) BETWEEN 1 AND 500),
  CONSTRAINT calendar_event_range_check CHECK (starts_at < ends_at),
  CONSTRAINT calendar_event_time_zone_check CHECK (length(btrim(time_zone)) BETWEEN 1 AND 80),
  CONSTRAINT calendar_event_guest_check CHECK (
    (origin = 'booking' AND guest_name IS NOT NULL AND guest_email IS NOT NULL)
    OR (origin <> 'booking' AND guest_name IS NULL AND guest_email IS NULL)
  ),
  CONSTRAINT calendar_event_version_check CHECK (version > 0)
);
ALTER TABLE calendar.events ADD CONSTRAINT calendar_events_no_overlap
  EXCLUDE USING gist (
    advisor_member_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed'));
CREATE INDEX calendar_events_agenda_idx ON calendar.events(calendar_id, starts_at, id);
CREATE INDEX calendar_events_advisor_idx ON calendar.events(advisor_member_id, starts_at, id);
CREATE INDEX calendar_events_contact_idx ON calendar.events(contact_id, starts_at, id) WHERE contact_id IS NOT NULL;
CREATE INDEX calendar_events_opportunity_idx ON calendar.events(opportunity_id, starts_at, id) WHERE opportunity_id IS NOT NULL;

CREATE TABLE calendar.event_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id uuid NOT NULL REFERENCES calendar.events(id) ON DELETE RESTRICT,
  event_type varchar(24) NOT NULL,
  actor_type varchar(16) NOT NULL,
  actor_member_id uuid,
  previous_value varchar(4000),
  next_value varchar(4000),
  created_at timestamptz(6) NOT NULL,
  CONSTRAINT calendar_history_event_type_check CHECK (event_type IN ('created', 'updated', 'rescheduled', 'status_changed')),
  CONSTRAINT calendar_history_actor_type_check CHECK (actor_type IN ('member', 'public', 'system')),
  CONSTRAINT calendar_history_actor_check CHECK (
    (actor_type = 'member' AND actor_member_id IS NOT NULL)
    OR (actor_type <> 'member' AND actor_member_id IS NULL)
  )
);
CREATE INDEX calendar_event_history_idx ON calendar.event_history(event_id, created_at DESC, id DESC);

CREATE TABLE calendar.reminders (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id uuid NOT NULL REFERENCES calendar.events(id) ON DELETE RESTRICT,
  audience varchar(16) NOT NULL,
  scheduled_at timestamptz(6) NOT NULL,
  status varchar(16) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  lease_owner varchar(120),
  lease_expires_at timestamptz(6),
  last_error_code varchar(120),
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT calendar_reminder_audience_check CHECK (audience IN ('client', 'advisor')),
  CONSTRAINT calendar_reminder_status_check CHECK (status IN ('pending', 'leased', 'sent', 'cancelled', 'failed')),
  CONSTRAINT calendar_reminder_attempts_check CHECK (attempts >= 0)
);
CREATE INDEX calendar_reminder_dispatch_idx
  ON calendar.reminders(status, scheduled_at, id) WHERE status IN ('pending', 'failed');

CREATE TABLE calendar.outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  event_id uuid NOT NULL REFERENCES calendar.events(id) ON DELETE RESTRICT,
  event_type varchar(120) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(16) NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner varchar(120),
  lease_expires_at timestamptz(6),
  last_error_code varchar(120),
  occurred_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT calendar_outbox_status_check CHECK (status IN ('pending', 'leased', 'published', 'failed', 'cancelled')),
  CONSTRAINT calendar_outbox_attempts_check CHECK (attempts >= 0)
);
CREATE INDEX calendar_outbox_dispatch_idx
  ON calendar.outbox(status, next_attempt_at, id) WHERE status IN ('pending', 'failed');

CREATE TABLE calendar.command_idempotency (
  principal_key varchar(200) NOT NULL,
  command varchar(80) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (principal_key, command, idempotency_key)
);

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, permission.code
FROM iam.roles AS role
CROSS JOIN (VALUES
  ('crm:calendar:read'), ('crm:calendar:create'), ('crm:calendar:update')
) AS permission(code)
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:calendar:configure'
FROM iam.roles AS role
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR')
ON CONFLICT DO NOTHING;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA calendar TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA calendar TO %I', runtime_role);
END $$;
