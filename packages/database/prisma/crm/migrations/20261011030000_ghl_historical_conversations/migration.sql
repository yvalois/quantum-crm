-- CHAT-01 / CHAT-14 / CON-01: inert source history. No relation to delivery outbox.
CREATE TABLE conversations.historical_threads (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  source_system varchar(32) NOT NULL CHECK (source_system = 'GHL'),
  source_location_id varchar(200) NOT NULL,
  source_external_id varchar(300) NOT NULL,
  source_thread_present boolean NOT NULL,
  contact_id uuid,
  source_contact_id varchar(300),
  assignee_member_id uuid,
  raw_channel varchar(200),
  raw_status varchar(200),
  subject text,
  source_created_at timestamptz(6),
  source_updated_at timestamptz(6),
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_at timestamptz(6),
  imported_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_system, source_location_id, source_external_id)
);
CREATE INDEX historical_threads_contact_idx ON conversations.historical_threads(contact_id, id DESC);
CREATE INDEX historical_threads_assignee_idx ON conversations.historical_threads(assignee_member_id, id DESC);

CREATE TABLE conversations.historical_messages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  thread_id uuid NOT NULL REFERENCES conversations.historical_threads(id) ON DELETE RESTRICT,
  source_system varchar(32) NOT NULL CHECK (source_system = 'GHL'),
  source_location_id varchar(200) NOT NULL,
  source_external_id varchar(300) NOT NULL,
  source_contact_id varchar(300),
  raw_channel varchar(200),
  raw_type varchar(200),
  raw_direction varchar(200),
  raw_status varchar(200),
  body text NOT NULL CHECK (length(body) <= 1000000),
  attachment_count integer NOT NULL DEFAULT 0 CHECK (attachment_count >= 0),
  source_created_at timestamptz(6),
  source_updated_at timestamptz(6),
  imported_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_system, source_location_id, source_external_id)
);
CREATE INDEX historical_messages_thread_idx ON conversations.historical_messages
  (thread_id, (COALESCE(source_created_at, 'infinity'::timestamptz)), id);

-- Private reconciliation/audit data: the HTTP read model never selects source_payload.
CREATE TABLE conversations.historical_imports (
  source_system varchar(32) NOT NULL CHECK (source_system = 'GHL'),
  source_location_id varchar(200) NOT NULL,
  entity_type varchar(40) NOT NULL,
  external_id varchar(300) NOT NULL,
  entity_id uuid NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  source_payload jsonb NOT NULL,
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_member_id uuid NOT NULL,
  imported_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_system, source_location_id, entity_type, external_id)
);
CREATE INDEX conversations_historical_import_entity_idx ON conversations.historical_imports(entity_type, entity_id);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT ON conversations.historical_threads, conversations.historical_messages, conversations.historical_imports TO %I', runtime_role);
  EXECUTE format('GRANT UPDATE (message_count, last_message_at) ON conversations.historical_threads TO %I', runtime_role);
END $$;
