-- ADR-0023: one tenant-local, idempotent bootstrap membership. The singleton
-- row is the durable idempotency boundary; it never contains a credential.
CREATE TABLE iam.bootstrap_initial_administrator (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  member_id uuid NOT NULL UNIQUE,
  oidc_subject varchar(255) NOT NULL UNIQUE,
  idempotency_key varchar(128) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT iam_bootstrap_initial_administrator_member_fkey
    FOREIGN KEY (member_id) REFERENCES iam.members(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT iam_bootstrap_initial_administrator_subject_check
    CHECK (oidc_subject ~ '^[!-~]{1,255}$'),
  CONSTRAINT iam_bootstrap_initial_administrator_idempotency_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$')
);

DO $$
DECLARE
  runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT ON iam.bootstrap_initial_administrator TO %I', runtime_role);
END $$;

REVOKE ALL ON iam.bootstrap_initial_administrator FROM PUBLIC;
