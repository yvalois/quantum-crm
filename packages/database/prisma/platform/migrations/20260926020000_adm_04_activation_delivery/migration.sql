-- ADR-0022: activation delivery is durable metadata only; no token, link or password is stored.
ALTER TYPE platform_iam.platform_permission ADD VALUE IF NOT EXISTS 'deployments:activate';

CREATE TYPE operations.activation_delivery_status AS ENUM (
  'pending', 'claimed', 'delivered', 'consumed', 'expired', 'discarded'
);
CREATE TYPE operations.tenant_initial_administrator_status AS ENUM ('pending', 'activation_issued', 'consumed');

CREATE TABLE tenants.tenant_initial_administrators (
  tenant_profile_id uuid PRIMARY KEY REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT,
  keycloak_subject varchar(255),
  generation integer NOT NULL DEFAULT 0,
  status operations.tenant_initial_administrator_status NOT NULL DEFAULT 'pending',
  expires_at timestamptz(6),
  consumed_at timestamptz(6),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_initial_administrator_generation_check CHECK (generation >= 0),
  CONSTRAINT tenant_initial_administrator_subject_check CHECK (keycloak_subject IS NULL OR keycloak_subject ~ '^[!-~]{1,255}$'),
  CONSTRAINT tenant_initial_administrator_state_check CHECK (
    (status = 'pending' AND expires_at IS NULL AND consumed_at IS NULL) OR
    (status = 'activation_issued' AND keycloak_subject IS NOT NULL AND expires_at IS NOT NULL AND consumed_at IS NULL) OR
    (status = 'consumed' AND keycloak_subject IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE TABLE operations.activation_delivery_intents (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT,
  requested_by_operator_id uuid NOT NULL REFERENCES platform_iam.operator_memberships(id) ON DELETE RESTRICT,
  administrator_subject varchar(255) NOT NULL,
  generation integer NOT NULL,
  expires_at timestamptz(6) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL,
  status operations.activation_delivery_status NOT NULL DEFAULT 'pending',
  lease_owner varchar(128),
  lease_expires_at timestamptz(6),
  result_code varchar(64),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT activation_delivery_generation_check CHECK (generation > 0),
  CONSTRAINT activation_delivery_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT activation_delivery_idempotency_check CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  CONSTRAINT activation_delivery_correlation_check CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT activation_delivery_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT activation_delivery_actor_idempotency_key UNIQUE (requested_by_operator_id, idempotency_key)
);
CREATE UNIQUE INDEX activation_delivery_one_pending_per_tenant_idx
  ON operations.activation_delivery_intents (tenant_profile_id)
  WHERE status IN ('pending', 'claimed');
CREATE INDEX activation_delivery_status_created_idx
  ON operations.activation_delivery_intents (status, created_at, id);

REVOKE ALL ON operations.activation_delivery_intents FROM PUBLIC;
