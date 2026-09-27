-- USR-05: explicit section actions used by role matrices and server authorization.
ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update',
    'iam:members:deactivate', 'iam:members:export', 'iam:members:roles',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update',
    'crm:contacts:delete', 'crm:contacts:export',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:update',
    'crm:sales:delete', 'crm:sales:export', 'crm:sales:configure', 'crm:sales:move',
    'crm:tasks:read', 'crm:tasks:create', 'crm:tasks:update',
    'crm:tasks:delete', 'crm:tasks:export'
  )
);

REVOKE ALL ON TABLE iam.role_permissions FROM PUBLIC;

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, permission.code
FROM iam.roles AS role
CROSS JOIN (VALUES
  ('iam:members:export'),
  ('crm:contacts:delete'), ('crm:contacts:export'),
  ('crm:sales:update'), ('crm:sales:delete'), ('crm:sales:export'),
  ('crm:tasks:delete'), ('crm:tasks:export')
) AS permission(code)
WHERE role.code = 'ADMINISTRATOR'
ON CONFLICT DO NOTHING;
