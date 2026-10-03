-- DOC-14: private file reservations, durable completion and authorized references.
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
    'crm:conversations:assign', 'crm:conversations:control-agent', 'crm:conversations:configure',
    'crm:documents:read', 'crm:documents:create', 'crm:documents:update', 'crm:documents:templates',
    'crm:files:read', 'crm:files:upload', 'crm:files:reference', 'crm:files:download', 'crm:files:delete'
  )
);

CREATE SCHEMA files;

CREATE TABLE files.files (
  id uuid PRIMARY KEY,
  owner_member_id uuid NOT NULL,
  owner_kind varchar(16) NOT NULL,
  owner_module varchar(40),
  owner_type varchar(80),
  owner_id uuid,
  attachment_claim_id uuid,
  file_class varchar(24) NOT NULL,
  original_name varchar(255) NOT NULL,
  declared_mime varchar(160) NOT NULL,
  detected_mime varchar(160),
  declared_size bigint NOT NULL,
  expected_sha256 char(44) NOT NULL,
  verified_sha256 char(44),
  status varchar(24) NOT NULL DEFAULT 'pending',
  incoming_key varchar(255) NOT NULL UNIQUE,
  incoming_version_id varchar(255),
  completion_receipt varchar(2048),
  observed_mime varchar(160),
  observed_size bigint,
  observed_sha256 char(44),
  scan_verdict varchar(24),
  scanner_version varchar(160),
  scanner_signatures_updated_at timestamptz(6),
  object_key varchar(255) UNIQUE,
  object_version_id varchar(255),
  completion_requested_at timestamptz(6),
  available_at timestamptz(6),
  expires_at timestamptz(6) NOT NULL,
  rejection_code varchar(80),
  delete_after timestamptz(6),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT files_owner_check CHECK (
    (owner_kind = 'existing' AND attachment_claim_id IS NULL AND owner_id IS NOT NULL AND (
      (owner_module = 'documents' AND owner_type IN ('commercial_document', 'document_template'))
      OR (owner_module = 'conversations' AND owner_type IN ('conversation', 'message'))
      OR (owner_module = 'forms' AND owner_type = 'form_response')
      OR (owner_module = 'catalog' AND owner_type IN ('product', 'variant'))
    ))
    OR (owner_kind = 'claim' AND owner_module IS NULL AND owner_type IS NULL
      AND owner_id IS NULL AND attachment_claim_id IS NOT NULL)
  ),
  CONSTRAINT files_class_check CHECK (file_class IN ('image', 'audio', 'document', 'video')),
  CONSTRAINT files_name_check CHECK (length(btrim(original_name)) BETWEEN 1 AND 255),
  CONSTRAINT files_declared_size_check CHECK (declared_size > 0 AND declared_size <= 262144000),
  CONSTRAINT files_expected_sha256_check CHECK (expected_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  CONSTRAINT files_verified_sha256_check CHECK (
    verified_sha256 IS NULL OR verified_sha256 ~ '^[A-Za-z0-9+/]{43}=$'
  ),
  CONSTRAINT files_observed_sha256_check CHECK (
    observed_sha256 IS NULL OR observed_sha256 ~ '^[A-Za-z0-9+/]{43}=$'
  ),
  CONSTRAINT files_scan_verdict_check CHECK (
    scan_verdict IS NULL OR scan_verdict IN ('clean', 'infected', 'unavailable', 'uninspectable')
  ),
  CONSTRAINT files_rejection_code_check CHECK (
    rejection_code IS NULL OR rejection_code IN (
      'checksum_mismatch', 'size_mismatch', 'type_mismatch', 'malware', 'uninspectable',
      'upload_missing', 'upload_receipt_invalid'
    )
  ),
  CONSTRAINT files_status_check CHECK (
    status IN (
      'pending', 'uploaded', 'scanning', 'quarantined', 'promoting', 'available',
      'rejected', 'failed', 'delete_scheduled', 'delete_pending', 'deleted'
    )
  ),
  CONSTRAINT files_versions_check CHECK (
    (incoming_version_id IS NULL OR completion_requested_at IS NOT NULL)
    AND (status <> 'available' OR (
      object_key IS NOT NULL AND object_version_id IS NOT NULL
      AND verified_sha256 IS NOT NULL AND available_at IS NOT NULL
    ))
  ),
  CONSTRAINT files_version_check CHECK (version > 0)
);

CREATE INDEX files_owner_updated_idx
  ON files.files(owner_module, owner_type, owner_id, updated_at DESC, id DESC);
CREATE INDEX files_claim_idx ON files.files(attachment_claim_id) WHERE attachment_claim_id IS NOT NULL;
CREATE INDEX files_member_updated_idx
  ON files.files(owner_member_id, updated_at DESC, id DESC);
CREATE INDEX files_processing_idx
  ON files.files(status, updated_at, id)
  WHERE status IN ('pending', 'uploaded', 'scanning', 'quarantined', 'promoting', 'delete_pending');
CREATE UNIQUE INDEX files_incoming_version_unique
  ON files.files(incoming_key, incoming_version_id)
  WHERE incoming_version_id IS NOT NULL;
CREATE UNIQUE INDEX files_object_version_unique
  ON files.files(object_key, object_version_id)
  WHERE object_key IS NOT NULL AND object_version_id IS NOT NULL;

CREATE TABLE files.operations (
  id uuid PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES files.files(id) ON DELETE RESTRICT,
  kind varchar(32) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  requested_by_member_id uuid NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  lease_owner varchar(160),
  lease_expires_at timestamptz(6),
  result jsonb,
  failure_code varchar(80),
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  completed_at timestamptz(6),
  CONSTRAINT file_operations_kind_check CHECK (kind IN ('process_upload', 'delete')),
  CONSTRAINT file_operations_status_check CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  CONSTRAINT file_operations_generation_check CHECK (generation > 0),
  CONSTRAINT file_operations_result_check CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);
CREATE INDEX file_operations_pending_idx
  ON files.operations(status, updated_at, id)
  WHERE status IN ('pending', 'running');
CREATE INDEX file_operations_file_idx ON files.operations(file_id, created_at DESC, id DESC);

CREATE TABLE files.references (
  id uuid PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES files.files(id) ON DELETE RESTRICT,
  module varchar(40) NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id uuid NOT NULL,
  purpose varchar(40) NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_by_member_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL,
  CONSTRAINT file_references_module_check CHECK (
    (module = 'documents' AND resource_type IN ('commercial_document', 'document_template'))
    OR (module = 'conversations' AND resource_type IN ('conversation', 'message'))
    OR (module = 'forms' AND resource_type = 'form_response')
    OR (module = 'catalog' AND resource_type IN ('product', 'variant'))
  ),
  CONSTRAINT file_references_purpose_check CHECK (
    purpose IN ('inline_image', 'attachment', 'logo', 'background', 'signature')
  ),
  CONSTRAINT file_references_position_check CHECK (position >= 0),
  UNIQUE (file_id, module, resource_type, resource_id, purpose)
);
CREATE INDEX file_references_resource_idx
  ON files.references(module, resource_type, resource_id, position, id);

CREATE TABLE files.command_idempotency (
  principal_key varchar(200) NOT NULL,
  command varchar(80) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (principal_key, command, idempotency_key)
);

CREATE TABLE files.outbox (
  id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL REFERENCES files.files(id) ON DELETE RESTRICT,
  event_type varchar(80) NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL,
  published_at timestamptz(6),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz(6) NOT NULL,
  CONSTRAINT files_outbox_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT files_outbox_attempts_check CHECK (attempts >= 0)
);
CREATE INDEX files_outbox_pending_idx
  ON files.outbox(available_at, id)
  WHERE published_at IS NULL;

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, permission.code
FROM iam.roles AS role
CROSS JOIN (VALUES
  ('crm:files:read'), ('crm:files:upload'), ('crm:files:reference'), ('crm:files:download')
) AS permission(code)
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:files:delete'
FROM iam.roles AS role
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR')
ON CONFLICT DO NOTHING;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA files TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA files TO %I', runtime_role);
END $$;
