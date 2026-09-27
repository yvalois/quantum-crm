-- USR-06: durable commercial scope and IAM teams inside each CRM profile.
-- This migration is additive and forward-only. Existing OWN behavior is
-- translated to ASSIGNED so it cannot silently widen visibility.
CREATE TYPE iam.commercial_scope AS ENUM ('profile', 'team', 'assigned');

ALTER TABLE iam.members
  ADD COLUMN commercial_scope iam.commercial_scope NOT NULL DEFAULT 'assigned';

UPDATE iam.members AS member
SET commercial_scope = CASE
  WHEN EXISTS (
    SELECT 1
    FROM iam.member_roles AS member_role
    JOIN iam.roles AS role ON role.id = member_role.role_id
    WHERE member_role.member_id = member.id
      AND role.code = 'ADMINISTRATOR'
  ) THEN 'profile'::iam.commercial_scope
  WHEN EXISTS (
    SELECT 1
    FROM iam.member_roles AS member_role
    JOIN iam.roles AS role ON role.id = member_role.role_id
    WHERE member_role.member_id = member.id
      AND role.code = 'SUPERVISOR'
  ) THEN 'team'::iam.commercial_scope
  ELSE 'assigned'::iam.commercial_scope
END;

CREATE TABLE iam.teams (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(160) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iam_teams_name_key UNIQUE (name),
  CONSTRAINT iam_teams_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 160)
);

CREATE TABLE iam.team_members (
  team_id uuid NOT NULL,
  member_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iam_team_members_pkey PRIMARY KEY (team_id, member_id),
  CONSTRAINT iam_team_members_team_id_fkey FOREIGN KEY (team_id)
    REFERENCES iam.teams(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT iam_team_members_member_id_fkey FOREIGN KEY (member_id)
    REFERENCES iam.members(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX iam_team_members_member_team_idx ON iam.team_members (member_id, team_id);

CREATE OR REPLACE FUNCTION iam.bump_team_authorization_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE changed_team_id uuid;
DECLARE previous_team_id uuid;
DECLARE previous_member_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    changed_team_id := NEW.team_id;
  ELSIF TG_OP = 'DELETE' THEN
    changed_team_id := OLD.team_id;
    previous_member_id := OLD.member_id;
  ELSE
    changed_team_id := NEW.team_id;
    previous_team_id := OLD.team_id;
    previous_member_id := OLD.member_id;
  END IF;
  UPDATE iam.members AS member
  SET authorization_revision = member.authorization_revision + 1,
      updated_at = CURRENT_TIMESTAMP
  WHERE member.id IN (
    SELECT team_member.member_id
    FROM iam.team_members AS team_member
    WHERE team_member.team_id = changed_team_id
    UNION
    SELECT team_member.member_id
    FROM iam.team_members AS team_member
    WHERE team_member.team_id = previous_team_id
    UNION
    SELECT previous_member_id
    WHERE previous_member_id IS NOT NULL
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER iam_team_members_authorization_revision_trg
AFTER INSERT OR UPDATE OR DELETE ON iam.team_members
FOR EACH ROW EXECUTE FUNCTION iam.bump_team_authorization_revision();

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON iam.teams, iam.team_members TO %I', runtime_role);
END $$;

REVOKE ALL ON iam.teams, iam.team_members FROM PUBLIC;
