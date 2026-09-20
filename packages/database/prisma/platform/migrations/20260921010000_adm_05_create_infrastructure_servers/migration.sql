-- ADM-05 / infrastructure: confirmed server inventory and bounded capacity.
CREATE SCHEMA IF NOT EXISTS infrastructure;
REVOKE ALL ON SCHEMA infrastructure FROM PUBLIC;

CREATE TYPE infrastructure.server_status AS ENUM (
  'available',
  'draining',
  'unavailable'
);

CREATE TYPE infrastructure.server_architecture AS ENUM (
  'x86_64',
  'arm64'
);

CREATE TABLE infrastructure.servers (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  code public.citext NOT NULL,
  display_name text NOT NULL,
  provider text NOT NULL,
  region text NOT NULL,
  public_ipv4 inet NOT NULL,
  operating_system text NOT NULL,
  architecture infrastructure.server_architecture NOT NULL,
  status infrastructure.server_status NOT NULL,
  total_cpu_millicores integer NOT NULL,
  total_memory_mib integer NOT NULL,
  total_storage_mib integer NOT NULL,
  reserved_cpu_millicores integer NOT NULL DEFAULT 0,
  reserved_memory_mib integer NOT NULL DEFAULT 0,
  reserved_storage_mib integer NOT NULL DEFAULT 0,
  operation_credential_ref varchar(263) NOT NULL,
  confirmed_at timestamptz(6) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT infrastructure_servers_code_key UNIQUE (code),
  CONSTRAINT infrastructure_servers_public_ipv4_key UNIQUE (public_ipv4),
  CONSTRAINT infrastructure_servers_code_check CHECK (
    code::text ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  CONSTRAINT infrastructure_servers_display_name_check CHECK (
    char_length(btrim(display_name)) BETWEEN 1 AND 160
  ),
  CONSTRAINT infrastructure_servers_provider_check CHECK (
    char_length(btrim(provider)) BETWEEN 1 AND 120
  ),
  CONSTRAINT infrastructure_servers_region_check CHECK (
    char_length(btrim(region)) BETWEEN 1 AND 120
  ),
  CONSTRAINT infrastructure_servers_public_ipv4_check CHECK (family(public_ipv4) = 4),
  CONSTRAINT infrastructure_servers_operating_system_check CHECK (
    char_length(btrim(operating_system)) BETWEEN 1 AND 160
  ),
  CONSTRAINT infrastructure_servers_total_capacity_check CHECK (
    total_cpu_millicores > 0 AND total_memory_mib > 0 AND total_storage_mib > 0
  ),
  CONSTRAINT infrastructure_servers_reserved_capacity_check CHECK (
    reserved_cpu_millicores BETWEEN 0 AND total_cpu_millicores
    AND reserved_memory_mib BETWEEN 0 AND total_memory_mib
    AND reserved_storage_mib BETWEEN 0 AND total_storage_mib
  ),
  CONSTRAINT infrastructure_servers_credential_ref_check CHECK (
    operation_credential_ref ~ '^secret://[a-z0-9][a-z0-9/_-]{2,253}$'
  ),
  CONSTRAINT infrastructure_servers_version_check CHECK (version > 0)
);

CREATE INDEX infrastructure_servers_status_created_id_idx
  ON infrastructure.servers (status, created_at, id);

REVOKE ALL ON ALL TABLES IN SCHEMA infrastructure FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA infrastructure FROM PUBLIC;
