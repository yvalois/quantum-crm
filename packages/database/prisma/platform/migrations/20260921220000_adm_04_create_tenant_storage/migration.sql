-- ADM-04-f / tenants: durable storage references without S3 credential values.
CREATE TYPE tenants.tenant_storage_status AS ENUM ('ready', 'error');
CREATE TYPE tenants.tenant_storage_secret_kind AS ENUM ('access_key', 'secret_key');

ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'storage_target_conflict';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'storage_unavailable';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'storage_permission_denied';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE 'storage_identity_mismatch';

CREATE TABLE tenants.tenant_storage (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL UNIQUE,
  server_id uuid NOT NULL,
  incoming_bucket varchar(63) NOT NULL UNIQUE,
  objects_bucket varchar(63) NOT NULL UNIQUE,
  quota_mib integer NOT NULL,
  status tenants.tenant_storage_status NOT NULL DEFAULT 'ready',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_storage_tenant_profile_id_fkey FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_storage_server_id_fkey FOREIGN KEY (server_id)
    REFERENCES infrastructure.servers(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_storage_status_version_check CHECK (version > 0),
  CONSTRAINT tenant_storage_quota_mib_check CHECK (quota_mib > 0),
  CONSTRAINT tenant_storage_bucket_shape_check CHECK (
    incoming_bucket ~ '^qcrm-[0-9a-f]{32}-incoming$'
    AND objects_bucket ~ '^qcrm-[0-9a-f]{32}-objects$'
  )
);

CREATE INDEX tenant_storage_server_id_idx ON tenants.tenant_storage (server_id);
CREATE INDEX tenant_storage_status_updated_id_idx
  ON tenants.tenant_storage (status, updated_at, id);

CREATE TABLE tenants.tenant_storage_secrets (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_storage_id uuid NOT NULL,
  kind tenants.tenant_storage_secret_kind NOT NULL,
  secret_ref varchar(128) NOT NULL UNIQUE,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_storage_secrets_storage_id_fkey FOREIGN KEY (tenant_storage_id)
    REFERENCES tenants.tenant_storage(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT tenant_storage_secrets_storage_kind_key UNIQUE (tenant_storage_id, kind),
  CONSTRAINT tenant_storage_secrets_secret_ref_shape_check CHECK (
    secret_ref ~ '^tenant/[0-9a-f-]{36}/storage-(access-key|secret-key)$'
  ),
  CONSTRAINT tenant_storage_secrets_version_check CHECK (version > 0)
);

CREATE INDEX tenant_storage_secrets_updated_id_idx
  ON tenants.tenant_storage_secrets (updated_at, id);

REVOKE ALL ON TABLE tenants.tenant_storage FROM PUBLIC;
REVOKE ALL ON TABLE tenants.tenant_storage_secrets FROM PUBLIC;
