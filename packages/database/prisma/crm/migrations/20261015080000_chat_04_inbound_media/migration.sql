-- CHAT-04: persist provider media before downloading; only validated Files objects reach an agent.
CREATE TABLE conversations.inbound_media (
  message_id uuid PRIMARY KEY REFERENCES conversations.messages(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES conversations.conversations(id) ON DELETE RESTRICT,
  provider_media_id varchar(80) NOT NULL,
  expected_sha256 varchar(44) NOT NULL,
  declared_mime varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'waiting_scan', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  next_attempt_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner varchar(120),
  lease_expires_at timestamptz(6),
  lease_generation bigint NOT NULL DEFAULT 0,
  file_id uuid REFERENCES files.files(id) ON DELETE RESTRICT,
  analysis varchar(8000),
  failure_code varchar(80),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT inbound_media_provider_id_check CHECK (provider_media_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  CONSTRAINT inbound_media_sha256_check CHECK (expected_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  CONSTRAINT inbound_media_completed_check CHECK (status <> 'completed' OR (file_id IS NOT NULL AND analysis IS NOT NULL))
);
CREATE INDEX inbound_media_work_idx ON conversations.inbound_media(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'leased', 'waiting_scan');
CREATE INDEX inbound_media_conversation_idx ON conversations.inbound_media(conversation_id, created_at);
CREATE INDEX inbound_media_file_idx ON conversations.inbound_media(file_id) WHERE file_id IS NOT NULL;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON conversations.inbound_media TO %I', runtime_role);
END $$;
