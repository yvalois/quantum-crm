-- ADM-04-d / tenants: durable identity of each provisioned PostgreSQL database.
CREATE TYPE tenants.tenant_database_status AS ENUM (
  'provisioning',
  'created',
  'error'
);

ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'database_target_conflict';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'database_unavailable';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'database_permission_denied';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'database_identity_mismatch';

CREATE TABLE tenants.tenant_databases (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL,
  server_id uuid NOT NULL,
  database_name varchar(63) NOT NULL,
  migrator_role_name varchar(63) NOT NULL,
  runtime_role_name varchar(63) NOT NULL,
  status tenants.tenant_database_status NOT NULL DEFAULT 'provisioning',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_databases_tenant_profile_id_fkey FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_databases_server_id_fkey FOREIGN KEY (server_id)
    REFERENCES infrastructure.servers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_databases_tenant_profile_id_key UNIQUE (tenant_profile_id),
  CONSTRAINT tenant_databases_database_name_key UNIQUE (database_name),
  CONSTRAINT tenant_databases_migrator_role_name_key UNIQUE (migrator_role_name),
  CONSTRAINT tenant_databases_runtime_role_name_key UNIQUE (runtime_role_name),
  CONSTRAINT tenant_databases_database_name_shape_check CHECK (
    database_name ~ '^qcrm_t_[0-9a-f]{32}$'
  ),
  CONSTRAINT tenant_databases_migrator_role_name_shape_check CHECK (
    migrator_role_name ~ '^qcrm_m_[0-9a-f]{32}$'
  ),
  CONSTRAINT tenant_databases_runtime_role_name_shape_check CHECK (
    runtime_role_name ~ '^qcrm_r_[0-9a-f]{32}$'
  ),
  CONSTRAINT tenant_databases_version_check CHECK (version > 0)
);

CREATE INDEX tenant_databases_server_id_idx ON tenants.tenant_databases (server_id);
CREATE INDEX tenant_databases_status_updated_id_idx
  ON tenants.tenant_databases (status, updated_at, id);
REVOKE ALL ON TABLE tenants.tenant_databases FROM PUBLIC;
