-- ADM-01 / ADM-02: platform operators assigned from a tenant profile.
CREATE TYPE platform_iam.profile_operator_assignment_status AS ENUM (
  'pending',
  'active',
  'failed'
);

CREATE TABLE platform_iam.profile_operator_assignments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_profile_id uuid NOT NULL,
  requested_by_operator_id uuid NOT NULL,
  operator_id uuid,
  oidc_subject varchar(255),
  display_name varchar(160) NOT NULL,
  email citext NOT NULL,
  status platform_iam.profile_operator_assignment_status NOT NULL DEFAULT 'pending',
  correlation_id varchar(128) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  lease_owner varchar(128),
  lease_expires_at timestamptz(6),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT profile_operator_assignments_tenant_profile_fkey FOREIGN KEY (tenant_profile_id)
    REFERENCES tenants.tenant_profiles(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT profile_operator_assignments_requested_by_fkey FOREIGN KEY (requested_by_operator_id)
    REFERENCES platform_iam.operator_memberships(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT profile_operator_assignments_operator_fkey FOREIGN KEY (operator_id)
    REFERENCES platform_iam.operator_memberships(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT profile_operator_assignments_subject_check CHECK (
    oidc_subject IS NULL OR oidc_subject ~ '^[!-~]{1,255}$'
  ),
  CONSTRAINT profile_operator_assignments_version_check CHECK (version > 0),
  CONSTRAINT profile_operator_assignments_active_identity_check CHECK (
    status <> 'active' OR (operator_id IS NOT NULL AND oidc_subject IS NOT NULL)
  ),
  CONSTRAINT profile_operator_assignments_actor_idempotency_key UNIQUE (
    requested_by_operator_id,
    idempotency_key
  ),
  CONSTRAINT profile_operator_assignments_tenant_email_key UNIQUE (tenant_profile_id, email)
);

CREATE INDEX profile_operator_assignments_claim_idx
  ON platform_iam.profile_operator_assignments (status, lease_expires_at, created_at, id)
  WHERE status = 'pending';
CREATE INDEX profile_operator_assignments_tenant_idx
  ON platform_iam.profile_operator_assignments (tenant_profile_id, created_at, id);
CREATE INDEX profile_operator_assignments_operator_idx
  ON platform_iam.profile_operator_assignments (operator_id)
  WHERE operator_id IS NOT NULL;

REVOKE ALL ON platform_iam.profile_operator_assignments FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON platform_iam.profile_operator_assignments TO qcrm_platform_runtime;
