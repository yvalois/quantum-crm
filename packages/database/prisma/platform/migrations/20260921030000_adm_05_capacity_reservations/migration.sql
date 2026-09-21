-- ADM-05 / infrastructure: durable profile placement and atomic capacity admission.
CREATE TYPE infrastructure.capacity_reservation_status AS ENUM (
  'reserved',
  'active',
  'released'
);

CREATE TABLE infrastructure.capacity_reservations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL,
  server_id uuid NOT NULL,
  release_id uuid NOT NULL,
  status infrastructure.capacity_reservation_status NOT NULL DEFAULT 'reserved',
  cpu_millicores integer NOT NULL,
  memory_mib integer NOT NULL,
  storage_mib integer NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT capacity_reservations_tenant_profile_id_fkey FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT capacity_reservations_server_id_fkey FOREIGN KEY (server_id)
    REFERENCES infrastructure.servers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT capacity_reservations_capacity_check CHECK (
    cpu_millicores > 0 AND memory_mib > 0 AND storage_mib > 0
  )
);

CREATE UNIQUE INDEX capacity_reservations_one_open_per_tenant_idx
  ON infrastructure.capacity_reservations (tenant_profile_id)
  WHERE status IN ('reserved', 'active');
CREATE INDEX capacity_reservations_server_status_created_id_idx
  ON infrastructure.capacity_reservations (server_id, status, created_at, id);

ALTER TABLE operations.provisioning_operations
  ADD COLUMN capacity_reservation_id uuid,
  ADD COLUMN requested_cpu_millicores integer,
  ADD COLUMN requested_memory_mib integer,
  ADD COLUMN requested_storage_mib integer,
  ADD CONSTRAINT provisioning_operations_requested_capacity_check CHECK (
    (capacity_reservation_id IS NULL
      AND requested_cpu_millicores IS NULL
      AND requested_memory_mib IS NULL
      AND requested_storage_mib IS NULL)
    OR
    (capacity_reservation_id IS NOT NULL
      AND requested_cpu_millicores > 0
      AND requested_memory_mib > 0
      AND requested_storage_mib > 0)
  ),
  ADD CONSTRAINT provisioning_operations_capacity_reservation_id_fkey
    FOREIGN KEY (capacity_reservation_id)
    REFERENCES infrastructure.capacity_reservations(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT provisioning_operations_capacity_reservation_id_key
    UNIQUE (capacity_reservation_id);

-- Pre-ADM-05 intents did not reserve capacity and cannot be executed safely.
UPDATE operations.provisioning_operations
SET
  status = 'cancelled',
  lease_owner = NULL,
  lease_expires_at = NULL,
  last_heartbeat_at = NULL,
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE status IN ('pending', 'running')
  AND capacity_reservation_id IS NULL;

-- Existing rows can contain pre-inventory identifiers from ADM-04. New writes are
-- enforced immediately; validation of historical rows follows their reconciliation.
ALTER TABLE tenants.tenant_profiles
  ADD CONSTRAINT tenant_profiles_server_id_fkey
    FOREIGN KEY (server_id)
    REFERENCES infrastructure.servers(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
    NOT VALID;

ALTER TABLE operations.provisioning_operations
  ADD CONSTRAINT provisioning_operations_server_id_fkey
    FOREIGN KEY (server_id)
    REFERENCES infrastructure.servers(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
    NOT VALID;

REVOKE ALL ON TABLE infrastructure.capacity_reservations FROM PUBLIC;
