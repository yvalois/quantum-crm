-- ADM-10 / OPS-12: durable update operation for an already provisioned tenant.
CREATE TYPE operations.tenant_release_promotion_status AS ENUM (
  'pending', 'running', 'succeeded', 'failed'
);

CREATE TYPE operations.tenant_release_promotion_step AS ENUM (
  'validate', 'migrate', 'reconcile', 'verify', 'activate'
);

CREATE TYPE operations.tenant_release_promotion_failure_code AS ENUM (
  'tenant_state_invalid', 'release_not_validated', 'target_conflict', 'migration_failed',
  'reconciliation_failed', 'verification_failed', 'permission_denied', 'unavailable'
);

CREATE TABLE operations.tenant_release_promotions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL,
  previous_release_id uuid NOT NULL,
  target_release_id uuid NOT NULL,
  requested_by_operator_id uuid NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  status operations.tenant_release_promotion_status NOT NULL DEFAULT 'pending',
  current_step operations.tenant_release_promotion_step NOT NULL DEFAULT 'validate',
  attempt integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  failure_code operations.tenant_release_promotion_failure_code,
  lease_owner varchar(128),
  lease_expires_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_release_promotions_tenant_fkey FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_release_promotions_previous_release_fkey FOREIGN KEY (previous_release_id)
    REFERENCES releases.releases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_release_promotions_target_release_fkey FOREIGN KEY (target_release_id)
    REFERENCES releases.releases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_release_promotions_operator_fkey FOREIGN KEY (requested_by_operator_id)
    REFERENCES platform_iam.operator_memberships(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_release_promotions_idempotency_key_check CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  CONSTRAINT tenant_release_promotions_correlation_id_check CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT tenant_release_promotions_attempt_check CHECK (attempt >= 0),
  CONSTRAINT tenant_release_promotions_version_check CHECK (version > 0),
  CONSTRAINT tenant_release_promotions_distinct_release_check CHECK (previous_release_id <> target_release_id)
);

CREATE UNIQUE INDEX tenant_release_promotions_actor_idempotency_key_uq
  ON operations.tenant_release_promotions (requested_by_operator_id, idempotency_key);
CREATE UNIQUE INDEX tenant_release_promotions_one_open_per_tenant_uq
  ON operations.tenant_release_promotions (tenant_profile_id)
  WHERE status IN ('pending', 'running');
CREATE INDEX tenant_release_promotions_claim_idx
  ON operations.tenant_release_promotions (status, lease_expires_at, created_at, id)
  WHERE status IN ('pending', 'running');

REVOKE ALL ON operations.tenant_release_promotions FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON operations.tenant_release_promotions TO qcrm_platform_runtime;
