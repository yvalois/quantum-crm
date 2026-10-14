-- CAL-03/12/16: explicit whole-calendar visibility and reusable appointment types.
ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate',
    'iam:members:export', 'iam:members:roles', 'iam:teams:read', 'iam:teams:create', 'iam:teams:update',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update', 'crm:contacts:assign', 'crm:contacts:delete', 'crm:contacts:export',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:update', 'crm:sales:assign', 'crm:sales:delete', 'crm:sales:export',
    'crm:sales:configure', 'crm:sales:move', 'crm:tasks:read', 'crm:tasks:create', 'crm:tasks:update',
    'crm:tasks:delete', 'crm:tasks:export', 'crm:calendar:read', 'crm:calendar:read-all', 'crm:calendar:create',
    'crm:calendar:update', 'crm:calendar:configure', 'crm:automations:read', 'crm:automations:execute',
    'crm:automations:configure', 'crm:conversations:read', 'crm:conversations:reply',
    'crm:conversations:assign', 'crm:conversations:control-agent', 'crm:conversations:configure',
    'crm:documents:read', 'crm:documents:create', 'crm:documents:update', 'crm:documents:templates',
    'crm:files:read', 'crm:files:upload', 'crm:files:reference', 'crm:files:download', 'crm:files:delete',
    'crm:forms:read', 'crm:forms:write', 'crm:forms:publish', 'crm:forms:responses'
  )
);

INSERT INTO iam.role_permissions (role_id, permission)
SELECT id, 'crm:calendar:read-all'
FROM iam.roles
WHERE code IN ('ADMINISTRATOR', 'SUPERVISOR')
ON CONFLICT DO NOTHING;

UPDATE iam.roles
SET authorization_revision = authorization_revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('ADMINISTRATOR', 'SUPERVISOR');

UPDATE iam.members AS member
SET authorization_revision = member.authorization_revision + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM iam.member_roles AS assignment
  JOIN iam.roles AS role ON role.id = assignment.role_id
  WHERE assignment.member_id = member.id AND role.code IN ('ADMINISTRATOR', 'SUPERVISOR')
);

CREATE TABLE calendar.appointment_types (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(160) NOT NULL,
  duration_minutes integer NOT NULL,
  created_by_member_id uuid NOT NULL REFERENCES iam.members(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT calendar_appointment_type_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT calendar_appointment_type_duration_check CHECK (duration_minutes BETWEEN 5 AND 480)
);
CREATE UNIQUE INDEX calendar_appointment_type_name_unique ON calendar.appointment_types (lower(name));

ALTER TABLE calendar.events
  ADD COLUMN appointment_type_id uuid REFERENCES calendar.appointment_types(id) ON DELETE RESTRICT;
CREATE INDEX calendar_events_appointment_type_idx ON calendar.events (appointment_type_id)
  WHERE appointment_type_id IS NOT NULL;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT ON calendar.appointment_types TO %I', runtime_role);
END $$;
