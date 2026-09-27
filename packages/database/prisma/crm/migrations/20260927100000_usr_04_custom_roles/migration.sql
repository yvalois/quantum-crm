-- USR-04: profile-local custom roles with the same validated CRM permission catalog.
ALTER TABLE iam.roles DROP CONSTRAINT iam_roles_code_check;
ALTER TABLE iam.roles ADD CONSTRAINT iam_roles_code_check CHECK (
  code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR')
  OR code ~ '^CUSTOM_[A-Z0-9_]{1,71}$'
);

ALTER TABLE iam.roles ADD COLUMN authorization_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE iam.roles ADD CONSTRAINT iam_roles_authorization_revision_check
  CHECK (authorization_revision > 0);

REVOKE ALL ON TABLE iam.roles FROM PUBLIC;
REVOKE ALL ON TABLE iam.role_permissions FROM PUBLIC;
