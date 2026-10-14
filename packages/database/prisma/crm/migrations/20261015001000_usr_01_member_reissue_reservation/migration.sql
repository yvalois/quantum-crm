ALTER TABLE iam.invitations
  ADD COLUMN reissue_request_key varchar(128),
  ADD COLUMN reissue_reserved_generation integer,
  ADD COLUMN reissue_reserved_at timestamptz(6),
  ADD CONSTRAINT iam_invitations_reissue_reservation_check CHECK (
    (reissue_reserved_generation IS NULL AND reissue_reserved_at IS NULL)
    OR (reissue_reserved_generation > activation_generation AND reissue_reserved_at IS NOT NULL)
  );

CREATE TABLE iam.invitation_reissue_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  invitation_id uuid NOT NULL REFERENCES iam.invitations(id) ON DELETE RESTRICT,
  actor_member_id uuid NOT NULL REFERENCES iam.members(id) ON DELETE RESTRICT,
  request_key varchar(128) NOT NULL,
  generation integer NOT NULL CHECK (generation > 1),
  state varchar(12) NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'issued')),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_at timestamptz(6),
  UNIQUE (invitation_id, generation),
  UNIQUE (actor_member_id, request_key)
);
CREATE INDEX iam_invitation_reissue_events_invitation_idx
  ON iam.invitation_reissue_events(invitation_id, created_at DESC);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, UPDATE (reissue_request_key, reissue_reserved_generation, reissue_reserved_at, expires_at, status) ON iam.invitations TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE (state, issued_at) ON iam.invitation_reissue_events TO %I', runtime_role);
END $$;
