-- USR-01: profile-managed accounts belong to the isolated CRM, not platform IAM.
ALTER TABLE platform_iam.profile_operator_assignments
  ADD COLUMN crm_member_id uuid;

ALTER TABLE platform_iam.profile_operator_assignments
  DROP CONSTRAINT profile_operator_assignments_active_identity_check;

ALTER TABLE platform_iam.profile_operator_assignments
  ADD CONSTRAINT profile_operator_assignments_active_identity_check CHECK (
    status <> 'active'
    OR (
      oidc_subject IS NOT NULL
      AND (crm_member_id IS NOT NULL OR operator_id IS NOT NULL)
    )
  );

CREATE INDEX profile_operator_assignments_crm_member_idx
  ON platform_iam.profile_operator_assignments (tenant_profile_id, crm_member_id)
  WHERE crm_member_id IS NOT NULL;
