-- ADM-02-d: a deleted profile remains as an audit tombstone but no longer
-- reserves its operational hostname. New profiles always receive a new UUID.
ALTER TABLE tenants.tenant_profiles
  DROP CONSTRAINT tenant_profiles_slug_key;

CREATE UNIQUE INDEX tenant_profiles_live_slug_uq
  ON tenants.tenant_profiles (slug)
  WHERE status <> 'deleted'::tenants.tenant_status;
