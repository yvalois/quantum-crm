-- DOC-01..16: persistent drafts, block editor, reusable templates and immutable revisions.
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
    'crm:documents:read', 'crm:documents:create', 'crm:documents:update', 'crm:documents:templates'
  )
);

CREATE SCHEMA documents;

CREATE TABLE documents.templates (
  id uuid PRIMARY KEY,
  kind varchar(16) NOT NULL,
  name varchar(180) NOT NULL,
  blocks jsonb NOT NULL,
  design jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT document_template_kind_check CHECK (kind IN ('quote', 'invoice')),
  CONSTRAINT document_template_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 180),
  CONSTRAINT document_template_blocks_check CHECK (jsonb_typeof(blocks) = 'array' AND jsonb_array_length(blocks) <= 250),
  CONSTRAINT document_template_design_check CHECK (jsonb_typeof(design) = 'object'),
  CONSTRAINT document_template_revision_check CHECK (revision > 0),
  CONSTRAINT document_template_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX document_template_name_kind_unique ON documents.templates(kind, lower(name));

CREATE TABLE documents.documents (
  id uuid PRIMARY KEY,
  kind varchar(16) NOT NULL,
  status varchar(16) NOT NULL,
  title varchar(240) NOT NULL,
  contact_id uuid,
  opportunity_id uuid,
  owner_member_id uuid NOT NULL,
  source_template_id uuid REFERENCES documents.templates(id) ON DELETE RESTRICT,
  blocks jsonb NOT NULL,
  design jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT commercial_document_kind_check CHECK (kind IN ('quote', 'invoice')),
  CONSTRAINT commercial_document_status_check CHECK (status IN ('draft')),
  CONSTRAINT commercial_document_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  CONSTRAINT commercial_document_blocks_check CHECK (jsonb_typeof(blocks) = 'array' AND jsonb_array_length(blocks) <= 250),
  CONSTRAINT commercial_document_design_check CHECK (jsonb_typeof(design) = 'object'),
  CONSTRAINT commercial_document_revision_check CHECK (revision > 0),
  CONSTRAINT commercial_document_version_check CHECK (version > 0)
);
CREATE INDEX commercial_document_owner_updated_idx ON documents.documents(owner_member_id, updated_at DESC, id DESC);
CREATE INDEX commercial_document_contact_idx ON documents.documents(contact_id, updated_at DESC, id DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX commercial_document_opportunity_idx ON documents.documents(opportunity_id, updated_at DESC, id DESC) WHERE opportunity_id IS NOT NULL;
CREATE INDEX commercial_document_template_idx ON documents.documents(source_template_id) WHERE source_template_id IS NOT NULL;

CREATE TABLE documents.document_revisions (
  document_id uuid NOT NULL REFERENCES documents.documents(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  actor_member_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL,
  PRIMARY KEY (document_id, revision),
  CONSTRAINT document_revision_positive_check CHECK (revision > 0),
  CONSTRAINT document_revision_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE TABLE documents.template_revisions (
  template_id uuid NOT NULL REFERENCES documents.templates(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  actor_member_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL,
  PRIMARY KEY (template_id, revision),
  CONSTRAINT template_revision_positive_check CHECK (revision > 0),
  CONSTRAINT template_revision_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE TABLE documents.command_idempotency (
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
  ('crm:documents:read'), ('crm:documents:create'), ('crm:documents:update')
) AS permission(code)
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:documents:templates'
FROM iam.roles AS role
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR')
ON CONFLICT DO NOTHING;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA documents TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA documents TO %I', runtime_role);
END $$;
