ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'configuration_target_conflict';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'configuration_unavailable';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'configuration_permission_denied';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'configuration_identity_mismatch';

CREATE TYPE tenants.tenant_configuration_status AS ENUM ('ready', 'error');

CREATE TABLE tenants.tenant_configurations (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL,
  server_id uuid NOT NULL,
  release_id uuid NOT NULL,
  manifest_ref varchar(256) NOT NULL,
  configuration_revision bigint NOT NULL DEFAULT 1,
  status tenants.tenant_configuration_status NOT NULL DEFAULT 'ready',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_configurations_tenant_profile_id_fkey
    FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_configurations_tenant_profile_id_key UNIQUE (tenant_profile_id),
  CONSTRAINT tenant_configurations_server_id_fkey
    FOREIGN KEY (server_id)
    REFERENCES infrastructure.servers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_configurations_release_id_fkey
    FOREIGN KEY (release_id)
    REFERENCES releases.releases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_configurations_manifest_ref_shape_check CHECK (
    manifest_ref ~ '^tenant/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/configuration[.]json$'
  ),
  CONSTRAINT tenant_configurations_revision_check CHECK (configuration_revision > 0),
  CONSTRAINT tenant_configurations_version_check CHECK (version > 0)
);

CREATE INDEX tenant_configurations_server_id_idx
  ON tenants.tenant_configurations (server_id);
CREATE INDEX tenant_configurations_status_updated_id_idx
  ON tenants.tenant_configurations (status, updated_at, id);

REVOKE ALL ON TABLE tenants.tenant_configurations FROM PUBLIC;
