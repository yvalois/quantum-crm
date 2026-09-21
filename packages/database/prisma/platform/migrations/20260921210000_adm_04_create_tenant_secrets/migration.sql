-- ADM-04-e / tenants: references for profile database secrets without values.
CREATE TYPE tenants.tenant_database_secret_kind AS ENUM (
  'migrator_password',
  'runtime_password'
);

CREATE TYPE tenants.tenant_database_secret_status AS ENUM (
  'ready',
  'error'
);

ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'secret_target_conflict';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'secret_unavailable';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'secret_permission_denied';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'secret_identity_mismatch';

CREATE TABLE tenants.tenant_database_secrets (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_database_id uuid NOT NULL,
  kind tenants.tenant_database_secret_kind NOT NULL,
  secret_ref varchar(128) NOT NULL,
  status tenants.tenant_database_secret_status NOT NULL DEFAULT 'ready',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_database_secrets_database_id_fkey FOREIGN KEY (tenant_database_id)
    REFERENCES tenants.tenant_databases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_database_secrets_database_kind_key UNIQUE (tenant_database_id, kind),
  CONSTRAINT tenant_database_secrets_secret_ref_key UNIQUE (secret_ref),
  CONSTRAINT tenant_database_secrets_secret_ref_shape_check CHECK (
    secret_ref ~ '^tenant/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(migrator-password|runtime-password)$'
  ),
  CONSTRAINT tenant_database_secrets_version_check CHECK (version > 0)
);

CREATE INDEX tenant_database_secrets_status_updated_id_idx
  ON tenants.tenant_database_secrets (status, updated_at, id);
REVOKE ALL ON TABLE tenants.tenant_database_secrets FROM PUBLIC;
