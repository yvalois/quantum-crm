-- USR-06 / PIPE-06: separate lead reassignment from ordinary editing.
ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate',
    'iam:members:export', 'iam:members:roles', 'iam:teams:read', 'iam:teams:create', 'iam:teams:update',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update', 'crm:contacts:assign', 'crm:contacts:delete', 'crm:contacts:export',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:update', 'crm:sales:assign', 'crm:sales:delete', 'crm:sales:export',
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

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:sales:assign'
FROM iam.roles AS role
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR')
ON CONFLICT DO NOTHING;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT UPDATE (assignee_member_id) ON conversations.historical_threads TO %I', runtime_role);
END $$;
