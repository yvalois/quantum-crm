-- CHAT-01..21: durable omnichannel inbox, messages, internal notes and handoff history.
ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate',
    'iam:members:export', 'iam:members:roles', 'iam:teams:read', 'iam:teams:create', 'iam:teams:update',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update', 'crm:contacts:delete', 'crm:contacts:export',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:update', 'crm:sales:delete', 'crm:sales:export',
    'crm:sales:configure', 'crm:sales:move', 'crm:tasks:read', 'crm:tasks:create', 'crm:tasks:update',
    'crm:tasks:delete', 'crm:tasks:export', 'crm:automations:read', 'crm:automations:execute',
    'crm:automations:configure', 'crm:conversations:read', 'crm:conversations:reply',
    'crm:conversations:assign', 'crm:conversations:control-agent', 'crm:conversations:configure'
  )
);

CREATE SCHEMA conversations;

CREATE TABLE conversations.conversations (
  id uuid PRIMARY KEY,
  contact_id uuid NOT NULL,
  channel varchar(16) NOT NULL,
  external_thread_id varchar(512),
  assignee_member_id uuid,
  status varchar(16) NOT NULL,
  attention_mode varchar(16) NOT NULL,
  subject varchar(240),
  last_message_preview varchar(280),
  last_message_at timestamptz(6),
  unread_count integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT conversations_channel_check CHECK (channel IN ('email', 'whatsapp', 'webchat', 'sms')),
  CONSTRAINT conversations_status_check CHECK (status IN ('open', 'pending', 'escalated', 'closed')),
  CONSTRAINT conversations_attention_check CHECK (attention_mode IN ('agent', 'human')),
  CONSTRAINT conversations_unread_check CHECK (unread_count >= 0),
  CONSTRAINT conversations_version_check CHECK (version > 0),
  CONSTRAINT conversations_subject_check CHECK (subject IS NULL OR length(btrim(subject)) BETWEEN 1 AND 240)
);
CREATE UNIQUE INDEX conversations_external_thread_unique
  ON conversations.conversations(channel, external_thread_id)
  WHERE external_thread_id IS NOT NULL;
CREATE INDEX conversations_inbox_idx
  ON conversations.conversations(status, last_message_at DESC, id DESC);
CREATE INDEX conversations_assignee_idx
  ON conversations.conversations(assignee_member_id, status, last_message_at DESC, id DESC);
CREATE INDEX conversations_contact_idx
  ON conversations.conversations(contact_id, last_message_at DESC, id DESC);

CREATE TABLE conversations.messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations.conversations(id) ON DELETE RESTRICT,
  sequence bigint NOT NULL,
  direction varchar(16) NOT NULL,
  kind varchar(16) NOT NULL,
  author_member_id uuid,
  body varchar(16000) NOT NULL,
  external_message_id varchar(512),
  delivery_status varchar(24) NOT NULL,
  failure_code varchar(120),
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT conversation_message_sequence_unique UNIQUE (conversation_id, sequence),
  CONSTRAINT conversation_message_direction_check CHECK (direction IN ('inbound', 'outbound', 'internal')),
  CONSTRAINT conversation_message_kind_check CHECK (kind IN ('text', 'image', 'audio', 'document', 'system')),
  CONSTRAINT conversation_message_delivery_check CHECK (delivery_status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed', 'unknown', 'not_applicable')),
  CONSTRAINT conversation_message_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 16000)
);
CREATE UNIQUE INDEX conversation_external_message_unique
  ON conversations.messages(conversation_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX conversation_messages_thread_idx
  ON conversations.messages(conversation_id, sequence ASC);

CREATE TABLE conversations.history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  conversation_id uuid NOT NULL REFERENCES conversations.conversations(id) ON DELETE RESTRICT,
  event_type varchar(32) NOT NULL,
  actor_member_id uuid NOT NULL,
  previous_value varchar(512),
  next_value varchar(512),
  created_at timestamptz(6) NOT NULL,
  CONSTRAINT conversation_history_event_check CHECK (event_type IN ('created', 'assigned', 'transferred', 'status_changed', 'attention_changed', 'message_added', 'note_added'))
);
CREATE INDEX conversation_history_thread_idx
  ON conversations.history(conversation_id, created_at ASC, id ASC);

CREATE TABLE conversations.quick_replies (
  id uuid PRIMARY KEY,
  title varchar(120) NOT NULL,
  body varchar(16000) NOT NULL,
  created_by_member_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT quick_reply_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT quick_reply_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 16000)
);
CREATE UNIQUE INDEX quick_reply_title_unique ON conversations.quick_replies(lower(title));

CREATE TABLE conversations.outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  message_id uuid NOT NULL UNIQUE REFERENCES conversations.messages(id) ON DELETE RESTRICT,
  channel varchar(16) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner varchar(120),
  lease_expires_at timestamptz(6),
  last_error_code varchar(120),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT conversation_outbox_channel_check CHECK (channel IN ('email', 'whatsapp', 'webchat', 'sms')),
  CONSTRAINT conversation_outbox_status_check CHECK (status IN ('pending', 'leased', 'sent', 'failed', 'cancelled')),
  CONSTRAINT conversation_outbox_attempts_check CHECK (attempts >= 0)
);
CREATE INDEX conversation_outbox_dispatch_idx
  ON conversations.outbox(status, next_attempt_at, id)
  WHERE status IN ('pending', 'failed');

CREATE TABLE conversations.command_idempotency (
  actor_member_id uuid NOT NULL,
  command varchar(64) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_member_id, command, idempotency_key)
);

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, permission.code
FROM iam.roles AS role
CROSS JOIN (VALUES
  ('crm:conversations:read'), ('crm:conversations:reply'),
  ('crm:conversations:control-agent')
) AS permission(code)
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, permission.code
FROM iam.roles AS role
CROSS JOIN (VALUES ('crm:conversations:assign'), ('crm:conversations:configure')) AS permission(code)
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR')
ON CONFLICT DO NOTHING;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA conversations TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA conversations TO %I', runtime_role);
END $$;
