-- ADM-04 / operations: durable, idempotent tenant provisioning intent.
CREATE SCHEMA IF NOT EXISTS operations;
REVOKE ALL ON SCHEMA operations FROM PUBLIC;

CREATE TYPE operations.provisioning_operation_status AS ENUM (
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

CREATE TYPE operations.provisioning_operation_step AS ENUM (
  'validate',
  'create_database',
  'create_secrets',
  'create_storage',
  'write_configuration',
  'start_containers',
  'configure_https',
  'create_administrator',
  'verify',
  'activate'
);

CREATE TABLE operations.provisioning_operations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL,
  server_id uuid NOT NULL,
  release_id uuid NOT NULL,
  requested_by_operator_id uuid NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  status operations.provisioning_operation_status NOT NULL DEFAULT 'pending',
  current_step operations.provisioning_operation_step NOT NULL DEFAULT 'validate',
  attempt integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provisioning_operations_tenant_profile_id_fkey FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT provisioning_operations_requested_by_operator_id_fkey FOREIGN KEY (requested_by_operator_id)
    REFERENCES platform_iam.operator_memberships(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT provisioning_operations_actor_idempotency_key_key UNIQUE (
    requested_by_operator_id,
    idempotency_key
  ),
  CONSTRAINT provisioning_operations_idempotency_key_check CHECK (
    idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'
  ),
  CONSTRAINT provisioning_operations_correlation_id_check CHECK (
    correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  CONSTRAINT provisioning_operations_attempt_check CHECK (attempt >= 0),
  CONSTRAINT provisioning_operations_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX provisioning_operations_one_open_per_tenant_idx
  ON operations.provisioning_operations (tenant_profile_id)
  WHERE status IN ('pending', 'running');
CREATE INDEX provisioning_operations_status_created_id_idx
  ON operations.provisioning_operations (status, created_at, id);

REVOKE ALL ON ALL TABLES IN SCHEMA operations FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA operations FROM PUBLIC;
