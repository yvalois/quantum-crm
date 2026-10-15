-- CHAT-07: durable, per-profile advisor turn and one assignment per contact.
CREATE TABLE conversations.advisor_route_turn (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  turn bigint NOT NULL DEFAULT 0 CHECK (turn >= 0)
);
INSERT INTO conversations.advisor_route_turn (singleton, turn) VALUES (true, 0);

CREATE TABLE conversations.advisor_route_assignments (
  contact_id uuid PRIMARY KEY,
  advisor_member_id uuid NOT NULL,
  source varchar(32) NOT NULL CHECK (source IN ('previous_advisor', 'round_robin')),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX advisor_route_assignments_member_idx
  ON conversations.advisor_route_assignments(advisor_member_id, created_at);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, UPDATE (turn) ON conversations.advisor_route_turn TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE (advisor_member_id, source) ON conversations.advisor_route_assignments TO %I', runtime_role);
END $$;
