-- ADM-04-i / tenants: durable HTTPS route identity and observed generation.
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'https_target_conflict';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'https_unavailable';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'https_permission_denied';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'https_identity_mismatch';

CREATE TYPE tenants.tenant_https_route_status AS ENUM (
  'configuring',
  'configured',
  'verified',
  'error'
);

CREATE TABLE tenants.tenant_https_routes (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL,
  server_id uuid NOT NULL,
  release_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  hostname varchar(255) NOT NULL,
  edge_network_name varchar(80) NOT NULL,
  upstream_services jsonb NOT NULL,
  configuration_revision bigint NOT NULL,
  operation_version bigint NOT NULL,
  attempt integer NOT NULL,
  route_generation bigint NOT NULL DEFAULT 1,
  observed_generation bigint,
  configured boolean NOT NULL DEFAULT false,
  reconciled boolean NOT NULL DEFAULT false,
  status tenants.tenant_https_route_status NOT NULL DEFAULT 'configuring',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_https_routes_tenant_profile_id_fkey
    FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_https_routes_server_id_fkey
    FOREIGN KEY (server_id)
    REFERENCES infrastructure.servers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_https_routes_release_id_fkey
    FOREIGN KEY (release_id)
    REFERENCES releases.releases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_https_routes_operation_id_fkey
    FOREIGN KEY (operation_id)
    REFERENCES operations.provisioning_operations(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_https_routes_tenant_profile_id_key UNIQUE (tenant_profile_id),
  CONSTRAINT tenant_https_routes_operation_id_key UNIQUE (operation_id),
  CONSTRAINT tenant_https_routes_hostname_key UNIQUE (hostname),
  CONSTRAINT tenant_https_routes_hostname_shape_check CHECK (
    hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.][0-9]{1,3}(-[0-9]{1,3}){3}[.]nip[.]io$'
  ),
  CONSTRAINT tenant_https_routes_edge_network_shape_check CHECK (
    edge_network_name ~ '^qcrm-tenant-edge-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT tenant_https_routes_upstream_services_array_check CHECK (
    jsonb_typeof(upstream_services) = 'array'
  ),
  CONSTRAINT tenant_https_routes_configuration_revision_check CHECK (configuration_revision > 0),
  CONSTRAINT tenant_https_routes_operation_version_check CHECK (operation_version > 0),
  CONSTRAINT tenant_https_routes_attempt_check CHECK (attempt > 0),
  CONSTRAINT tenant_https_routes_route_generation_check CHECK (route_generation > 0),
  CONSTRAINT tenant_https_routes_observed_generation_check CHECK (
    observed_generation IS NULL OR observed_generation > 0
  ),
  CONSTRAINT tenant_https_routes_version_check CHECK (version > 0)
);

CREATE INDEX tenant_https_routes_server_id_idx
  ON tenants.tenant_https_routes (server_id);
CREATE INDEX tenant_https_routes_status_updated_id_idx
  ON tenants.tenant_https_routes (status, updated_at, id);

REVOKE ALL ON TABLE tenants.tenant_https_routes FROM PUBLIC;
