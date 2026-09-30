-- ADM-04-k: durable, fenced and auditable cancellation of stalled provisioning.
CREATE TYPE operations.provisioning_cancellation_result AS ENUM ('cancelled');

ALTER TABLE operations.provisioning_operations
  ADD COLUMN cancelled_by_operator_id uuid,
  ADD COLUMN cancellation_idempotency_key varchar(128),
  ADD COLUMN cancellation_correlation_id varchar(128),
  ADD COLUMN cancellation_reason varchar(500),
  ADD COLUMN cancellation_expected_version bigint,
  ADD COLUMN cancellation_tenant_version bigint,
  ADD COLUMN cancellation_result operations.provisioning_cancellation_result,
  ADD COLUMN cancelled_at timestamptz(6),
  ADD CONSTRAINT provisioning_operations_cancelled_by_operator_id_fkey
    FOREIGN KEY (cancelled_by_operator_id)
    REFERENCES platform_iam.operator_memberships(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT provisioning_operations_cancellation_shape_check CHECK (
    (
      cancelled_by_operator_id IS NULL
      AND cancellation_idempotency_key IS NULL
      AND cancellation_correlation_id IS NULL
      AND cancellation_reason IS NULL
      AND cancellation_expected_version IS NULL
      AND cancellation_tenant_version IS NULL
      AND cancellation_result IS NULL
      AND cancelled_at IS NULL
    )
    OR
    (
      status = 'cancelled'
      AND cancelled_by_operator_id IS NOT NULL
      AND cancellation_idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'
      AND cancellation_correlation_id ~ '^[A-Za-z0-9._:-]{1,128}$'
      AND cancellation_reason = btrim(cancellation_reason)
      AND length(cancellation_reason) BETWEEN 3 AND 500
      AND cancellation_reason !~ '[[:cntrl:]]'
      AND cancellation_expected_version > 0
      AND cancellation_tenant_version > 0
      AND cancellation_result = 'cancelled'
      AND cancelled_at IS NOT NULL
    )
  );

CREATE INDEX provisioning_operations_cancelled_by_operator_id_idx
  ON operations.provisioning_operations (cancelled_by_operator_id, cancelled_at, id)
  WHERE cancelled_by_operator_id IS NOT NULL;

CREATE UNIQUE INDEX provisioning_operations_cancellation_idempotency_key_uq
  ON operations.provisioning_operations (
    cancelled_by_operator_id,
    cancellation_idempotency_key
  )
  WHERE cancelled_by_operator_id IS NOT NULL
    AND cancellation_idempotency_key IS NOT NULL;
