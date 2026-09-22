-- ADM-04-h / durable Compose observation and fencing for START_CONTAINERS.
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'containers_target_conflict';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'containers_unavailable';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'containers_permission_denied';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'containers_identity_mismatch';

CREATE TYPE tenants.tenant_container_status AS ENUM ('starting', 'ready', 'error');

CREATE TABLE tenants.tenant_containers (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL UNIQUE,
  server_id uuid NOT NULL,
  release_id uuid NOT NULL,
  operation_id uuid NOT NULL UNIQUE,
  manifest_ref varchar(256) NOT NULL,
  configuration_revision bigint NOT NULL,
  operation_version bigint NOT NULL,
  attempt integer NOT NULL,
  project_name varchar(80) NOT NULL,
  services jsonb NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  reconciled boolean NOT NULL DEFAULT false,
  status tenants.tenant_container_status NOT NULL DEFAULT 'starting',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_containers_tenant_profile_id_fkey FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_containers_server_id_fkey FOREIGN KEY (server_id)
    REFERENCES infrastructure.servers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_containers_release_id_fkey FOREIGN KEY (release_id)
    REFERENCES releases.releases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_containers_operation_id_fkey FOREIGN KEY (operation_id)
    REFERENCES operations.provisioning_operations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_containers_manifest_ref_shape_check CHECK (
    manifest_ref ~ '^tenant/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/configuration[.]json$'
  ),
  CONSTRAINT tenant_containers_configuration_revision_check CHECK (configuration_revision > 0),
  CONSTRAINT tenant_containers_operation_version_check CHECK (operation_version > 0),
  CONSTRAINT tenant_containers_attempt_check CHECK (attempt > 0),
  CONSTRAINT tenant_containers_project_name_shape_check CHECK (
    project_name ~ '^qcrm-t-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT tenant_containers_services_array_check CHECK (jsonb_typeof(services) = 'array'),
  CONSTRAINT tenant_containers_version_check CHECK (version > 0)
);

CREATE INDEX tenant_containers_server_id_idx ON tenants.tenant_containers (server_id);
CREATE INDEX tenant_containers_status_updated_id_idx
  ON tenants.tenant_containers (status, updated_at, id);

REVOKE ALL ON TABLE tenants.tenant_containers FROM PUBLIC;
