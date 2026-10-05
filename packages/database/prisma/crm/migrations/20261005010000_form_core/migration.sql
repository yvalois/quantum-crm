-- FORM-01..20: draft builder, immutable publication and public responses.
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
    'crm:files:read', 'crm:files:upload', 'crm:files:reference', 'crm:files:download', 'crm:files:delete',
    'crm:forms:read', 'crm:forms:write', 'crm:forms:publish', 'crm:forms:responses'
  )
);

CREATE SCHEMA forms;

CREATE TABLE forms.forms (
  id uuid PRIMARY KEY,
  slug varchar(80) NOT NULL,
  title varchar(240) NOT NULL,
  description varchar(4000) NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'draft',
  definition jsonb NOT NULL,
  theme jsonb NOT NULL,
  published_revision integer,
  closes_at timestamptz(6),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT forms_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{8}$'),
  CONSTRAINT forms_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  CONSTRAINT forms_description_check CHECK (length(description) <= 4000),
  CONSTRAINT forms_status_check CHECK (status IN ('draft', 'published', 'closed')),
  CONSTRAINT forms_definition_check CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT forms_theme_check CHECK (jsonb_typeof(theme) = 'object'),
  CONSTRAINT forms_published_revision_check CHECK (published_revision IS NULL OR published_revision > 0),
  CONSTRAINT forms_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX forms_slug_unique ON forms.forms(slug);
CREATE INDEX forms_updated_idx ON forms.forms(updated_at DESC, id DESC);

CREATE TABLE forms.versions (
  form_id uuid NOT NULL REFERENCES forms.forms(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  definition jsonb NOT NULL,
  theme jsonb NOT NULL,
  published_by_member_id uuid NOT NULL,
  published_at timestamptz(6) NOT NULL,
  PRIMARY KEY (form_id, revision),
  CONSTRAINT form_version_revision_check CHECK (revision > 0),
  CONSTRAINT form_version_definition_check CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT form_version_theme_check CHECK (jsonb_typeof(theme) = 'object')
);

CREATE TABLE forms.responses (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL,
  form_revision integer NOT NULL,
  contact_id uuid,
  answers jsonb NOT NULL,
  submitted_at timestamptz(6) NOT NULL,
  FOREIGN KEY (form_id, form_revision) REFERENCES forms.versions(form_id, revision) ON DELETE RESTRICT,
  CONSTRAINT form_response_answers_check CHECK (jsonb_typeof(answers) = 'object')
);
CREATE INDEX form_responses_form_submitted_idx
  ON forms.responses(form_id, submitted_at DESC, id DESC);
CREATE INDEX form_responses_contact_idx
  ON forms.responses(contact_id, submitted_at DESC, id DESC) WHERE contact_id IS NOT NULL;

CREATE TABLE forms.outbox (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  response_id uuid NOT NULL REFERENCES forms.responses(id) ON DELETE RESTRICT,
  event_type varchar(120) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner varchar(120),
  lease_expires_at timestamptz(6),
  last_error_code varchar(120),
  occurred_at timestamptz(6) NOT NULL,
  CONSTRAINT forms_outbox_status_check CHECK (status IN ('pending', 'leased', 'published', 'failed', 'cancelled')),
  CONSTRAINT forms_outbox_attempts_check CHECK (attempts >= 0)
);
CREATE INDEX forms_outbox_dispatch_idx
  ON forms.outbox(status, next_attempt_at, id) WHERE status IN ('pending', 'failed');

CREATE TABLE forms.command_idempotency (
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
  ('crm:forms:read'), ('crm:forms:write'), ('crm:forms:responses')
) AS permission(code)
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:forms:publish'
FROM iam.roles AS role
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR')
ON CONFLICT DO NOTHING;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA forms TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA forms TO %I', runtime_role);
END $$;
