-- CHAT-04 / CON-01: durable association only; files remains the owner of object state and keys.
CREATE TABLE conversations.historical_attachments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  message_id uuid NOT NULL REFERENCES conversations.historical_messages(id) ON DELETE RESTRICT,
  attachment_index integer NOT NULL CHECK (attachment_index >= 0),
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  file_id uuid,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'AVAILABLE', 'REJECTED', 'FAILED')),
  error_code varchar(40) CHECK (error_code IN ('SOURCE_UNAVAILABLE', 'UNSUPPORTED_FORMAT', 'SIZE_LIMIT',
    'CHECKSUM_MISMATCH', 'SCAN_REJECTED', 'SCAN_PENDING', 'TRANSFER_FAILED', 'SOURCE_CHANGED')),
  display_name varchar(255),
  mime_type varchar(160),
  byte_size bigint CHECK (byte_size > 0 AND byte_size <= 262144000),
  created_by_member_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (message_id, attachment_index),
  UNIQUE (file_id),
  CHECK (status <> 'AVAILABLE' OR (file_id IS NOT NULL AND error_code IS NULL AND
    display_name IS NOT NULL AND mime_type IS NOT NULL AND byte_size IS NOT NULL))
);

CREATE TABLE conversations.historical_attachment_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  attachment_id uuid NOT NULL REFERENCES conversations.historical_attachments(id) ON DELETE RESTRICT,
  actor_member_id uuid NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('PENDING', 'AVAILABLE', 'REJECTED', 'FAILED')),
  file_id uuid,
  error_code varchar(40),
  occurred_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX historical_attachment_events_attachment_idx
  ON conversations.historical_attachment_events(attachment_id, occurred_at);

ALTER TABLE files.files DROP CONSTRAINT files_owner_check;
ALTER TABLE files.files ADD CONSTRAINT files_owner_check CHECK (
  (owner_kind = 'existing' AND attachment_claim_id IS NULL AND owner_id IS NOT NULL AND (
    (owner_module = 'documents' AND owner_type IN ('commercial_document', 'document_template'))
    OR (owner_module = 'conversations' AND owner_type IN ('conversation', 'message', 'historical_attachment'))
    OR (owner_module = 'forms' AND owner_type = 'form_response')
    OR (owner_module = 'catalog' AND owner_type IN ('product', 'variant'))
  ))
  OR (owner_kind = 'claim' AND owner_module IS NULL AND owner_type IS NULL
    AND owner_id IS NULL AND attachment_claim_id IS NOT NULL)
);
ALTER TABLE files.references DROP CONSTRAINT file_references_module_check;
ALTER TABLE files.references ADD CONSTRAINT file_references_module_check CHECK (
  (module = 'documents' AND resource_type IN ('commercial_document', 'document_template'))
  OR (module = 'conversations' AND resource_type IN ('conversation', 'message', 'historical_attachment'))
  OR (module = 'forms' AND resource_type = 'form_response')
  OR (module = 'catalog' AND resource_type IN ('product', 'variant'))
);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT ON conversations.historical_attachments, conversations.historical_attachment_events TO %I', runtime_role);
  EXECUTE format('GRANT UPDATE (file_id, status, error_code, display_name, mime_type, byte_size, updated_at) ON conversations.historical_attachments TO %I', runtime_role);
END $$;
