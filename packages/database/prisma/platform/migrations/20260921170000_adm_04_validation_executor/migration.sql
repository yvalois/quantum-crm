-- ADM-04 / operations: durable VALIDATE results and typed terminal failures.
CREATE TYPE operations.provisioning_step_outcome AS ENUM (
  'succeeded',
  'failed'
);

CREATE TYPE operations.provisioning_validation_failure_code AS ENUM (
  'tenant_state_invalid',
  'tenant_placement_mismatch',
  'server_unavailable',
  'release_not_validated',
  'reservation_invalid',
  'capacity_accounting_invalid'
);

ALTER TABLE operations.provisioning_operations
  ADD COLUMN failure_code operations.provisioning_validation_failure_code,
  ADD CONSTRAINT provisioning_operations_failure_code_shape_check CHECK (
    failure_code IS NULL OR status = 'failed'
  ),
  ADD CONSTRAINT provisioning_operations_new_failure_requires_code_check CHECK (
    status <> 'failed' OR failure_code IS NOT NULL
  ) NOT VALID;

CREATE TABLE operations.provisioning_step_results (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  operation_id uuid NOT NULL,
  step operations.provisioning_operation_step NOT NULL,
  attempt integer NOT NULL,
  outcome operations.provisioning_step_outcome NOT NULL,
  worker_id varchar(128) NOT NULL,
  operation_version bigint NOT NULL,
  failure_code operations.provisioning_validation_failure_code,
  completed_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provisioning_step_results_operation_id_fkey FOREIGN KEY (operation_id)
    REFERENCES operations.provisioning_operations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT provisioning_step_results_attempt_check CHECK (attempt > 0),
  CONSTRAINT provisioning_step_results_operation_version_check CHECK (operation_version > 0),
  CONSTRAINT provisioning_step_results_worker_id_check CHECK (
    worker_id ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  CONSTRAINT provisioning_step_results_outcome_shape_check CHECK (
    (outcome = 'succeeded' AND failure_code IS NULL)
    OR
    (outcome = 'failed' AND failure_code IS NOT NULL)
  ),
  CONSTRAINT provisioning_step_results_operation_step_attempt_key UNIQUE (
    operation_id,
    step,
    attempt
  )
);

CREATE INDEX provisioning_step_results_operation_completed_id_idx
  ON operations.provisioning_step_results (operation_id, completed_at, id);

REVOKE ALL ON TABLE operations.provisioning_step_results FROM PUBLIC;
