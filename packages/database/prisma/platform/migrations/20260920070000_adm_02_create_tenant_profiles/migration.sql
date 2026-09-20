-- ADM-02 / tenants: first immutable platform profile schema.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS tenants;
REVOKE ALL ON SCHEMA tenants FROM PUBLIC;

CREATE TYPE tenants.tenant_status AS ENUM (
  'pending',
  'provisioning',
  'active',
  'suspended',
  'error'
);

CREATE TABLE tenants.tenant_profiles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL,
  slug public.citext NOT NULL,
  admin_contact_name text NOT NULL,
  admin_contact_email public.citext NOT NULL,
  status tenants.tenant_status NOT NULL DEFAULT 'pending',
  server_id uuid,
  release_id uuid,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT tenant_profiles_slug_key UNIQUE (slug),
  CONSTRAINT tenant_profiles_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT tenant_profiles_slug_check CHECK (slug::text ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  CONSTRAINT tenant_profiles_admin_contact_name_check CHECK (char_length(btrim(admin_contact_name)) BETWEEN 1 AND 160),
  CONSTRAINT tenant_profiles_admin_contact_email_check CHECK (
    char_length(admin_contact_email::text) <= 320
    AND admin_contact_email::text ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  CONSTRAINT tenant_profiles_version_check CHECK (version > 0)
);

CREATE INDEX tenant_profiles_status_created_id_idx
  ON tenants.tenant_profiles (status, created_at, id);
CREATE INDEX tenant_profiles_server_id_idx
  ON tenants.tenant_profiles (server_id)
  WHERE server_id IS NOT NULL;
CREATE INDEX tenant_profiles_release_id_idx
  ON tenants.tenant_profiles (release_id)
  WHERE release_id IS NOT NULL;

REVOKE ALL ON ALL TABLES IN SCHEMA tenants FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA tenants FROM PUBLIC;
