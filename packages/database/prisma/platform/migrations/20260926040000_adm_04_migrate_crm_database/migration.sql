-- ADM-04 / CON-04-a: a fenced, per-tenant CRM history is a first-class
-- provisioning step. It is additive and forward-only for existing operations.
ALTER TYPE operations.provisioning_operation_step ADD VALUE IF NOT EXISTS 'migrate_database' AFTER 'write_configuration';
ALTER TYPE operations.provisioning_validation_failure_code ADD VALUE IF NOT EXISTS 'migration_target_conflict';
ALTER TYPE operations.provisioning_validation_failure_code ADD VALUE IF NOT EXISTS 'migration_unavailable';
ALTER TYPE operations.provisioning_validation_failure_code ADD VALUE IF NOT EXISTS 'migration_permission_denied';
ALTER TYPE operations.provisioning_validation_failure_code ADD VALUE IF NOT EXISTS 'migration_identity_mismatch';
ALTER TYPE releases.release_artifact_name ADD VALUE IF NOT EXISTS 'crm-migrator';
ALTER TYPE releases.release_artifact_name ADD VALUE IF NOT EXISTS 'platform-keycloak';

-- Releases created under the original eight-artifact catalog remain immutable
-- historical evidence. New candidates use the complete enum catalog. Do not
-- compare a value added above as an enum literal in this migration: PostgreSQL
-- rejects use of a newly-added enum value before the migration transaction
-- commits.
ALTER TABLE releases.releases
  ADD COLUMN IF NOT EXISTS legacy_artifact_catalog boolean NOT NULL DEFAULT false;

-- The catalog is the release contract.  Future immutable artifacts extend the
-- enum and this deferred constraint follows that contract without another
-- hard-coded cardinality.
CREATE OR REPLACE FUNCTION releases.has_complete_artifact_set(release_identifier uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, releases
AS $$
  SELECT CASE
    WHEN release.legacy_artifact_catalog THEN
      count(artifact.name) = 8
    ELSE count(artifact.name) = (
      SELECT count(*) FROM unnest(enum_range(NULL::releases.release_artifact_name))
    )
  END
  FROM releases.releases AS release
  LEFT JOIN releases.release_artifacts AS artifact ON artifact.release_id = release.id
  WHERE release.id = release_identifier
  GROUP BY release.legacy_artifact_catalog
$$;

-- The previous deferred trigger already guaranteed exactly eight artifacts for
-- every historical release. Mark them before that trigger is evaluated again
-- at the end of this transaction; releases written later retain the default
-- false value and must satisfy the full enum catalog.
UPDATE releases.releases
SET legacy_artifact_catalog = TRUE
WHERE legacy_artifact_catalog = FALSE;

CREATE OR REPLACE FUNCTION releases.assert_release_artifacts_from_release()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, releases
AS $$
BEGIN
  IF NOT releases.has_complete_artifact_set(NEW.id) THEN
    RAISE EXCEPTION 'release artifact set must contain the complete catalog'
      USING ERRCODE = '23514', CONSTRAINT = 'releases_complete_artifact_set_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION releases.assert_release_artifacts_from_artifact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, releases
AS $$
DECLARE
  release_identifier uuid := COALESCE(NEW.release_id, OLD.release_id);
BEGIN
  IF EXISTS (SELECT 1 FROM releases.releases WHERE id = release_identifier)
     AND NOT releases.has_complete_artifact_set(release_identifier) THEN
    RAISE EXCEPTION 'release artifact set must contain the complete catalog'
      USING ERRCODE = '23514', CONSTRAINT = 'releases_complete_artifact_set_check';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
