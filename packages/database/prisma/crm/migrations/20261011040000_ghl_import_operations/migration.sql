-- integrations owns durable import intent/progress. Additive, forward-only.
-- No commercial data backfill and no destructive rollback.
CREATE SCHEMA IF NOT EXISTS integrations;
CREATE TABLE integrations.ghl_import_operations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  location_id text NOT NULL,
  export_id uuid NOT NULL,
  artifact_sha256 char(64) NOT NULL,
  currency char(3) NOT NULL,
  operator_member_id uuid NOT NULL,
  principal_type text NOT NULL DEFAULT 'MIGRATION_SERVICE',
  development_backup_exception boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN ('RUNNING','COMPLETE','CONFLICTS','FAILED')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (location_id, export_id)
);
CREATE TABLE integrations.ghl_import_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  operation_id uuid NOT NULL REFERENCES integrations.ghl_import_operations(id),
  event_type text NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA integrations TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON integrations.ghl_import_operations TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT ON integrations.ghl_import_events TO %I', runtime_role);
END $$;
