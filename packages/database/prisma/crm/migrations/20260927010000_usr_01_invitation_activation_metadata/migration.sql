-- USR-01 / IAM: durable Keycloak activation correlation for invited members.
-- This migration stores only references and timing metadata. Action URLs,
-- tokens, passwords and client secrets never enter the CRM database.
ALTER TABLE iam.invitations
  ADD COLUMN activation_subject varchar(255),
  ADD COLUMN activation_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN activation_issued_at timestamptz(6),
  ADD COLUMN activation_expires_at timestamptz(6),
  ADD CONSTRAINT iam_invitations_activation_generation_check CHECK (activation_generation >= 0),
  ADD CONSTRAINT iam_invitations_activation_subject_check CHECK (
    activation_subject IS NULL OR activation_subject ~ '^[!-~]{1,255}$'
  ),
  ADD CONSTRAINT iam_invitations_activation_metadata_check CHECK (
    (activation_generation = 0 AND activation_subject IS NULL
      AND activation_issued_at IS NULL AND activation_expires_at IS NULL)
    OR
    (activation_generation > 0 AND activation_subject IS NOT NULL
      AND activation_issued_at IS NOT NULL AND activation_expires_at IS NOT NULL
      AND activation_expires_at > activation_issued_at)
  );

CREATE INDEX iam_invitations_pending_activation_idx
  ON iam.invitations (status, expires_at, activation_generation)
  WHERE status = 'pending';

CREATE INDEX iam_invitations_activation_subject_idx
  ON iam.invitations (activation_subject)
  WHERE activation_subject IS NOT NULL;
