-- CON-01 / CON-06 / PIPE-06 / CHAT-07, owner IAM.
-- Additive and forward-only; no existing data changes or commercial backfill.
-- Only new tables are locked. Application rollback retains these historical records.
-- Source participants are descriptive identities, never members or login principals.
CREATE TABLE iam.external_participants (
  source_system varchar(32) NOT NULL CHECK (source_system = 'GHL'),
  source_location_id varchar(200) NOT NULL CHECK (source_location_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  external_id varchar(200) NOT NULL CHECK (external_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  display_name varchar(300) NOT NULL CHECK (length(btrim(display_name)) > 0),
  actor_member_id uuid NOT NULL,
  imported_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_system, source_location_id, external_id)
);

-- Immutable receipt is also the audit record; no notification or automation outbox.
CREATE TABLE iam.external_participant_imports (
  operation_id uuid NOT NULL,
  source_system varchar(32) NOT NULL CHECK (source_system = 'GHL'),
  source_location_id varchar(200) NOT NULL CHECK (source_location_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  total integer NOT NULL CHECK (total BETWEEN 0 AND 5000),
  created integer NOT NULL CHECK (created BETWEEN 0 AND total),
  actor_member_id uuid NOT NULL,
  imported_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_id, source_system, source_location_id)
);

REVOKE ALL ON iam.external_participants, iam.external_participant_imports FROM PUBLIC;
DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  -- Remove inherited default writes; these snapshots and receipts are append-only.
  EXECUTE format('REVOKE ALL ON iam.external_participants, iam.external_participant_imports FROM %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT ON iam.external_participants, iam.external_participant_imports TO %I', runtime_role);
END $$;
