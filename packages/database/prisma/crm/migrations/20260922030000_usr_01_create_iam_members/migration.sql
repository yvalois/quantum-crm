-- USR-01 / iam: memberships and one-time invitations inside one CRM profile database.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS iam;
REVOKE ALL ON SCHEMA iam FROM PUBLIC;

CREATE TYPE iam.member_status AS ENUM ('invited', 'active', 'deactivated');
CREATE TYPE iam.invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE iam.roles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  code varchar(80) NOT NULL,
  display_name varchar(160) NOT NULL,
  system boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iam_roles_code_key UNIQUE (code),
  CONSTRAINT iam_roles_code_check CHECK (code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR')),
  CONSTRAINT iam_roles_display_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 160)
);

CREATE TABLE iam.role_permissions (
  role_id uuid NOT NULL,
  permission varchar(128) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iam_role_permissions_pkey PRIMARY KEY (role_id, permission),
  CONSTRAINT iam_role_permissions_role_id_fkey FOREIGN KEY (role_id)
    REFERENCES iam.roles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT iam_role_permissions_permission_check CHECK (
    permission IN ('iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate')
  )
);

CREATE TABLE iam.members (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  oidc_subject varchar(255),
  display_name varchar(160) NOT NULL,
  email citext NOT NULL,
  status iam.member_status NOT NULL DEFAULT 'invited',
  authorization_revision bigint NOT NULL DEFAULT 1,
  deactivated_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iam_members_oidc_subject_key UNIQUE (oidc_subject),
  CONSTRAINT iam_members_email_key UNIQUE (email),
  CONSTRAINT iam_members_oidc_subject_check CHECK (
    oidc_subject IS NULL OR oidc_subject ~ '^[!-~]{1,255}$'
  ),
  CONSTRAINT iam_members_display_name_check CHECK (
    length(btrim(display_name)) BETWEEN 1 AND 160
  ),
  CONSTRAINT iam_members_authorization_revision_check CHECK (
    authorization_revision > 0
  ),
  CONSTRAINT iam_members_deactivation_check CHECK (
    (status = 'deactivated' AND deactivated_at IS NOT NULL)
    OR (status <> 'deactivated' AND deactivated_at IS NULL)
  ),
  CONSTRAINT iam_members_activation_check CHECK (
    (status = 'active' AND oidc_subject IS NOT NULL)
    OR status <> 'active'
  )
);

CREATE TABLE iam.invitations (
  id uuid NOT NULL DEFAULT uuidv7(),
  member_id uuid NOT NULL,
  created_by_member_id uuid NOT NULL,
  role_id uuid NOT NULL,
  token_hash char(64) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  status iam.invitation_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz(6) NOT NULL,
  accepted_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iam_invitations_pkey PRIMARY KEY (id),
  CONSTRAINT iam_invitations_token_hash_key UNIQUE (token_hash),
  CONSTRAINT iam_invitations_creator_idempotency_key UNIQUE (created_by_member_id, idempotency_key),
  CONSTRAINT iam_invitations_member_id_fkey FOREIGN KEY (member_id)
    REFERENCES iam.members(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT iam_invitations_created_by_member_id_fkey FOREIGN KEY (created_by_member_id)
    REFERENCES iam.members(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT iam_invitations_role_id_fkey FOREIGN KEY (role_id)
    REFERENCES iam.roles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT iam_invitations_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT iam_invitations_idempotency_key_check CHECK (
    idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'
  ),
  CONSTRAINT iam_invitations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT iam_invitations_acceptance_check CHECK (
    (status = 'accepted' AND accepted_at IS NOT NULL)
    OR (status <> 'accepted' AND accepted_at IS NULL)
  )
);

CREATE TABLE iam.member_roles (
  member_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iam_member_roles_pkey PRIMARY KEY (member_id, role_id),
  CONSTRAINT iam_member_roles_member_id_fkey FOREIGN KEY (member_id)
    REFERENCES iam.members(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT iam_member_roles_role_id_fkey FOREIGN KEY (role_id)
    REFERENCES iam.roles(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

INSERT INTO iam.roles (code, display_name) VALUES
  ('ADMINISTRATOR', 'Administrador'),
  ('SUPERVISOR', 'Supervisor'),
  ('ADVISOR', 'Asesor');

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, permission.code
FROM iam.roles AS role
CROSS JOIN LATERAL (
  VALUES
    ('ADMINISTRATOR', 'iam:members:read'),
    ('ADMINISTRATOR', 'iam:members:create'),
    ('ADMINISTRATOR', 'iam:members:update'),
    ('ADMINISTRATOR', 'iam:members:deactivate'),
    ('SUPERVISOR', 'iam:members:read'),
    ('ADVISOR', 'iam:members:read')
) AS permission(role_code, code)
WHERE role.code = permission.role_code;

CREATE INDEX iam_members_status_created_id_idx ON iam.members (status, created_at, id);
CREATE INDEX iam_invitations_member_status_expiry_idx
  ON iam.invitations (member_id, status, expires_at);
CREATE INDEX iam_member_roles_role_member_idx ON iam.member_roles (role_id, member_id);

DO $$
DECLARE
  runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA iam TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam TO %I', runtime_role);
  EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA iam TO %I', runtime_role);
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA iam GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
    runtime_role
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA iam GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
    runtime_role
  );
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA iam FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA iam FROM PUBLIC;
