-- CON-01 / CON-05 / PIPE-01: additive module-owned historical imports.
-- Raw source payloads remain private. Map and entity are committed atomically.
CREATE SCHEMA IF NOT EXISTS settings;

ALTER TABLE contacts.contacts
  ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT contacts_custom_fields_array CHECK (jsonb_typeof(custom_fields) = 'array');

CREATE TABLE settings.custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  field_key varchar(1000) NOT NULL,
  name varchar(1000) NOT NULL,
  description text NOT NULL,
  data_type varchar(100) NOT NULL,
  section varchar(100) NOT NULL,
  options jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contacts.historical_imports (
  source_system varchar(32) NOT NULL CHECK (source_system = 'GHL'),
  source_location_id varchar(200) NOT NULL,
  entity_type varchar(40) NOT NULL,
  external_id varchar(300) NOT NULL,
  entity_id uuid NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  source_payload jsonb NOT NULL,
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_member_id uuid NOT NULL,
  imported_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_system, source_location_id, entity_type, external_id)
);
CREATE INDEX contacts_historical_import_entity_idx ON contacts.historical_imports(entity_type, entity_id);

CREATE TABLE sales.historical_imports (
  source_system varchar(32) NOT NULL CHECK (source_system = 'GHL'),
  source_location_id varchar(200) NOT NULL,
  entity_type varchar(40) NOT NULL,
  external_id varchar(300) NOT NULL,
  entity_id uuid NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  source_payload jsonb NOT NULL,
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_member_id uuid NOT NULL,
  imported_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_system, source_location_id, entity_type, external_id)
);
CREATE INDEX sales_historical_import_entity_idx ON sales.historical_imports(entity_type, entity_id);

CREATE TABLE settings.historical_imports (
  source_system varchar(32) NOT NULL CHECK (source_system = 'GHL'),
  source_location_id varchar(200) NOT NULL,
  entity_type varchar(40) NOT NULL,
  external_id varchar(300) NOT NULL,
  entity_id uuid NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  source_payload jsonb NOT NULL,
  result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_member_id uuid NOT NULL,
  imported_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_system, source_location_id, entity_type, external_id)
);
CREATE INDEX settings_historical_import_entity_idx ON settings.historical_imports(entity_type, entity_id);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA settings TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT ON contacts.historical_imports, sales.historical_imports, settings.historical_imports, settings.custom_field_definitions TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT ON sales.opportunity_history TO %I', runtime_role);
END $$;
