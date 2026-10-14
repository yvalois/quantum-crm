-- REP-01: personal dashboard layout; additive and forward-only. Reporting owns this table.
CREATE SCHEMA reporting;
CREATE TABLE reporting.dashboard_preferences (
  member_id uuid PRIMARY KEY REFERENCES iam.members(id) ON DELETE RESTRICT,
  layout jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT dashboard_layout_object CHECK (jsonb_typeof(layout) = 'object')
);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA reporting TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON reporting.dashboard_preferences TO %I', runtime_role);
END $$;
