-- ADM-04 / ADM-12: durable lease and fencing for the restricted deploy executor.
ALTER TABLE operations.provisioning_operations
  ADD COLUMN lease_owner varchar(128),
  ADD COLUMN lease_expires_at timestamptz(6),
  ADD COLUMN last_heartbeat_at timestamptz(6),
  ADD CONSTRAINT provisioning_operations_lease_owner_check CHECK (
    lease_owner IS NULL OR lease_owner ~ '^[A-Za-z0-9._:-]{1,128}$'
  ),
  ADD CONSTRAINT provisioning_operations_lease_shape_check CHECK (
    (
      status = 'running'
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND last_heartbeat_at IS NOT NULL
      AND last_heartbeat_at <= lease_expires_at
    )
    OR
    (
      status <> 'running'
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND last_heartbeat_at IS NULL
    )
  );

CREATE INDEX provisioning_operations_claimable_idx
  ON operations.provisioning_operations (status, lease_expires_at, created_at, id)
  WHERE status IN ('pending', 'running');
