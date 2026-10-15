-- One durable switch for this profile. Pausing cancels pending executions, not chat history.
CREATE TABLE conversations.agent_control (
  id smallint PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_member_id uuid REFERENCES iam.members(id) ON DELETE RESTRICT,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO conversations.agent_control (id, enabled) VALUES (1, true);

CREATE TABLE conversations.agent_control_events (
  id uuid PRIMARY KEY,
  enabled boolean NOT NULL,
  actor_member_id uuid NOT NULL REFERENCES iam.members(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, UPDATE ON conversations.agent_control TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT ON conversations.agent_control_events TO %I', runtime_role);
END $$;
