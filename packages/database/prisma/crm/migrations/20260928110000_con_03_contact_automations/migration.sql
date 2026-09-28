-- CON-03: durable manual automation activation for contacts.
ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate',
    'iam:members:export', 'iam:members:roles', 'iam:teams:read', 'iam:teams:create', 'iam:teams:update',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update', 'crm:contacts:delete', 'crm:contacts:export',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:update', 'crm:sales:delete', 'crm:sales:export',
    'crm:sales:configure', 'crm:sales:move', 'crm:tasks:read', 'crm:tasks:create', 'crm:tasks:update',
    'crm:tasks:delete', 'crm:tasks:export', 'crm:automations:read', 'crm:automations:execute',
    'crm:automations:configure'
  )
);

CREATE SCHEMA automation;

CREATE TABLE automation.definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(160) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  trigger_event varchar(40) NOT NULL DEFAULT 'CONTACT_MANUAL',
  action_type varchar(40) NOT NULL,
  action_config jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT automation_definition_status_check CHECK (status IN ('draft', 'active', 'paused')),
  CONSTRAINT automation_definition_trigger_check CHECK (trigger_event = 'CONTACT_MANUAL'),
  CONSTRAINT automation_definition_action_check CHECK (action_type = 'CREATE_TASK'),
  CONSTRAINT automation_definition_name_check CHECK (length(btrim(name)) > 0)
);
CREATE INDEX automation_definitions_status_created_idx ON automation.definitions(status, created_at, id);

CREATE TABLE automation.executions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  definition_id uuid NOT NULL REFERENCES automation.definitions(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL,
  actor_member_id uuid NOT NULL,
  operation_key varchar(128) NOT NULL,
  status varchar(16) NOT NULL,
  task_id uuid,
  result jsonb,
  error_code varchar(80),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz(6),
  CONSTRAINT automation_execution_status_check CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT automation_execution_key_unique UNIQUE (definition_id, contact_id, operation_key)
);
CREATE INDEX automation_executions_contact_created_idx ON automation.executions(contact_id, created_at, id);

CREATE TABLE automation.command_idempotency (
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
CROSS JOIN (VALUES ('crm:automations:read'), ('crm:automations:execute')) AS permission(code)
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR')
ON CONFLICT DO NOTHING;

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:automations:configure'
FROM iam.roles AS role
WHERE role.code = 'ADMINISTRATOR'
ON CONFLICT DO NOTHING;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA automation TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA automation TO %I', runtime_role);
END $$;
