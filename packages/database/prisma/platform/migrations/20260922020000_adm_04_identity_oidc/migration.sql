-- ADM-04-j: typed terminal outcomes while reconciling OIDC and session identity.
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'identity_target_conflict';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'identity_unavailable';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'identity_permission_denied';
ALTER TYPE operations.provisioning_validation_failure_code
  ADD VALUE IF NOT EXISTS 'identity_identity_mismatch';
