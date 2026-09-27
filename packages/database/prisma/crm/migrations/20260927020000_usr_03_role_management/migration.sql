-- USR-03: only administrators may change a member's CRM role.
-- The permission is additive and role assignments remain profile-local.
ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update',
    'iam:members:deactivate', 'iam:members:roles',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:configure', 'crm:sales:move',
    'crm:tasks:read', 'crm:tasks:create', 'crm:tasks:update'
  )
);

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'iam:members:roles'
FROM iam.roles AS role
WHERE role.code = 'ADMINISTRATOR'
ON CONFLICT DO NOTHING;

REVOKE ALL ON TABLE iam.role_permissions FROM PUBLIC;
