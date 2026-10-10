-- CON-04-b: operational contact workspace. This migration is additive and
-- remains safe for the per-tenant forward-only migration runner.
ALTER TABLE contacts.contacts
  ALTER COLUMN owner_member_id DROP NOT NULL,
  ADD COLUMN source varchar(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN archived_at timestamptz(6);

ALTER TABLE contacts.contacts
  ADD CONSTRAINT contacts_source_check CHECK (
    source IN ('manual', 'import', 'form', 'conversation', 'api', 'migration', 'other')
  );

CREATE INDEX contacts_active_updated_idx
  ON contacts.contacts(updated_at DESC, id DESC)
  WHERE archived_at IS NULL;
CREATE INDEX contacts_archived_updated_idx
  ON contacts.contacts(updated_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;
CREATE INDEX contacts_active_owner_updated_idx
  ON contacts.contacts(owner_member_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL;
CREATE INDEX contacts_active_source_updated_idx
  ON contacts.contacts(source, updated_at DESC, id DESC)
  WHERE archived_at IS NULL;

ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate',
    'iam:members:export', 'iam:members:roles', 'iam:teams:read', 'iam:teams:create', 'iam:teams:update',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update', 'crm:contacts:assign', 'crm:contacts:delete', 'crm:contacts:export',
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

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:contacts:assign'
FROM iam.roles AS role
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR')
ON CONFLICT DO NOTHING;
