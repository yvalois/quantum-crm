-- ADM-09: durable, typed reconciliation of the shared Keycloak foundation.
CREATE TYPE operations.platform_foundation_promotion_status AS ENUM ('pending', 'running', 'succeeded', 'failed');
CREATE TYPE operations.platform_foundation_promotion_failure_code AS ENUM ('unavailable', 'identity_mismatch', 'target_conflict', 'permission_denied');
CREATE TABLE operations.platform_foundation_promotions (
  id uuid PRIMARY KEY DEFAULT uuidv7(), release_id uuid NOT NULL UNIQUE REFERENCES releases.releases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  requested_by_operator_id uuid NOT NULL REFERENCES platform_iam.operator_memberships(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  idempotency_key varchar(128) NOT NULL, correlation_id varchar(128) NOT NULL,
  status operations.platform_foundation_promotion_status NOT NULL DEFAULT 'pending', attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0), version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  lease_owner varchar(128), lease_expires_at timestamptz(6), failure_code operations.platform_foundation_promotion_failure_code,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (requested_by_operator_id, idempotency_key),
  CHECK ((status = 'running') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)), CHECK ((status = 'failed') = (failure_code IS NOT NULL))
);
CREATE INDEX platform_foundation_promotions_claim_idx ON operations.platform_foundation_promotions (status, created_at, id);
GRANT SELECT, INSERT, UPDATE ON operations.platform_foundation_promotions TO qcrm_platform_runtime;
