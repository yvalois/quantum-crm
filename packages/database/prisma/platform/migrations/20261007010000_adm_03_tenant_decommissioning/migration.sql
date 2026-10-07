-- ADM-03-b: durable, resumable decommissioning with a retained profile tombstone.
ALTER TYPE tenants.tenant_status ADD VALUE IF NOT EXISTS 'decommissioning';
ALTER TYPE tenants.tenant_status ADD VALUE IF NOT EXISTS 'deleted';

CREATE TYPE operations.tenant_decommissioning_status AS ENUM (
  'pending', 'running', 'succeeded', 'failed'
);

CREATE TYPE operations.tenant_decommissioning_step AS ENUM (
  'validate', 'stop_containers', 'remove_https', 'remove_identity',
  'remove_configuration', 'remove_storage', 'remove_database',
  'release_capacity', 'tombstone'
);

CREATE TYPE operations.tenant_decommissioning_failure_code AS ENUM (
  'tenant_state_invalid', 'target_conflict', 'containers_unavailable',
  'https_unavailable', 'identity_unavailable', 'configuration_unavailable',
  'storage_unavailable', 'database_unavailable', 'capacity_accounting_invalid',
  'permission_denied'
);

CREATE TABLE operations.tenant_decommissioning_operations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL,
  requested_by_operator_id uuid NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  confirmation_slug varchar(63) NOT NULL,
  status operations.tenant_decommissioning_status NOT NULL DEFAULT 'pending',
  current_step operations.tenant_decommissioning_step NOT NULL DEFAULT 'validate',
  attempt integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  failure_code operations.tenant_decommissioning_failure_code,
  lease_owner varchar(128),
  lease_expires_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_decommissioning_operations_tenant_fkey FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_decommissioning_operations_operator_fkey FOREIGN KEY (requested_by_operator_id)
    REFERENCES platform_iam.operator_memberships(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_decommissioning_operations_idempotency_key_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  CONSTRAINT tenant_decommissioning_operations_correlation_id_check
    CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT tenant_decommissioning_operations_confirmation_slug_check
    CHECK (confirmation_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  CONSTRAINT tenant_decommissioning_operations_attempt_check CHECK (attempt >= 0),
  CONSTRAINT tenant_decommissioning_operations_version_check CHECK (version > 0)
);

CREATE UNIQUE INDEX tenant_decommissioning_operations_actor_idempotency_key_uq
  ON operations.tenant_decommissioning_operations (requested_by_operator_id, idempotency_key);
CREATE UNIQUE INDEX tenant_decommissioning_operations_one_open_per_tenant_uq
  ON operations.tenant_decommissioning_operations (tenant_profile_id)
  WHERE status IN ('pending', 'running');
CREATE INDEX tenant_decommissioning_operations_claim_idx
  ON operations.tenant_decommissioning_operations (status, lease_expires_at, created_at, id)
  WHERE status IN ('pending', 'running');

REVOKE ALL ON operations.tenant_decommissioning_operations FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON operations.tenant_decommissioning_operations TO qcrm_platform_runtime;
