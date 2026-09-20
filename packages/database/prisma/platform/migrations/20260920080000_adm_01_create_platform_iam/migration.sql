-- ADM-01 / platform-iam: operator memberships and closed platform permissions.
CREATE SCHEMA IF NOT EXISTS platform_iam;
REVOKE ALL ON SCHEMA platform_iam FROM PUBLIC;

CREATE TYPE platform_iam.operator_status AS ENUM (
  'pending',
  'active',
  'suspended'
);

CREATE TYPE platform_iam.platform_permission AS ENUM (
  'tenants:read',
  'tenants:manage',
  'configuration:read',
  'configuration:manage',
  'deployments:read',
  'deployments:execute',
  'operators:manage'
);

CREATE TABLE platform_iam.operator_memberships (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  oidc_subject varchar(255) NOT NULL,
  status platform_iam.operator_status NOT NULL DEFAULT 'pending',
  authorization_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT operator_memberships_oidc_subject_key UNIQUE (oidc_subject),
  CONSTRAINT operator_memberships_oidc_subject_check CHECK (
    oidc_subject ~ '^[!-~]{1,255}$'
  ),
  CONSTRAINT operator_memberships_authorization_revision_check CHECK (
    authorization_revision > 0
  )
);

CREATE TABLE platform_iam.operator_permissions (
  operator_id uuid NOT NULL,
  permission platform_iam.platform_permission NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT operator_permissions_pkey PRIMARY KEY (operator_id, permission),
  CONSTRAINT operator_permissions_operator_id_fkey FOREIGN KEY (operator_id)
    REFERENCES platform_iam.operator_memberships(id)
    ON DELETE CASCADE
    ON UPDATE RESTRICT
);

CREATE INDEX operator_memberships_status_created_id_idx
  ON platform_iam.operator_memberships (status, created_at, id);
CREATE INDEX operator_permissions_permission_operator_idx
  ON platform_iam.operator_permissions (permission, operator_id);

REVOKE ALL ON ALL TABLES IN SCHEMA platform_iam FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA platform_iam FROM PUBLIC;
