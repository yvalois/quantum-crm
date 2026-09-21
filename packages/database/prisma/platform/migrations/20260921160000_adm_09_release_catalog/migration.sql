-- ADM-09 / releases: immutable artifact catalog and deployable release state.
CREATE SCHEMA releases;

CREATE TYPE releases.release_status AS ENUM ('candidate', 'validated', 'retired');
CREATE TYPE releases.release_artifact_name AS ENUM (
  'crm-web',
  'portal-web',
  'admin-web',
  'api',
  'admin-api',
  'worker',
  'deploy-executor',
  'agent-runtime'
);

CREATE TABLE releases.releases (
  id uuid PRIMARY KEY,
  semantic_version varchar(80) NOT NULL,
  commit_sha char(40) NOT NULL,
  status releases.release_status NOT NULL DEFAULT 'candidate',
  release_notes text NOT NULL,
  configuration_schema_version integer NOT NULL,
  agent_contract_version varchar(80) NOT NULL,
  database_migration_required boolean NOT NULL,
  minimum_source_version varchar(80),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT releases_semantic_version_key UNIQUE (semantic_version),
  CONSTRAINT releases_commit_sha_key UNIQUE (commit_sha),
  CONSTRAINT releases_semantic_version_check CHECK (
    semantic_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
  ),
  CONSTRAINT releases_commit_sha_check CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT releases_notes_check CHECK (length(btrim(release_notes)) BETWEEN 1 AND 10000),
  CONSTRAINT releases_configuration_schema_version_check CHECK (configuration_schema_version > 0),
  CONSTRAINT releases_agent_contract_version_check CHECK (
    agent_contract_version ~ '^[a-z][a-z0-9-]*/v[1-9][0-9]*$'
  ),
  CONSTRAINT releases_minimum_source_version_check CHECK (
    minimum_source_version IS NULL
    OR (
      database_migration_required
      AND minimum_source_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
    )
  )
);

CREATE INDEX releases_status_created_id_idx
  ON releases.releases (status, created_at, id);

CREATE TABLE releases.release_artifacts (
  release_id uuid NOT NULL,
  name releases.release_artifact_name NOT NULL,
  digest char(71) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT release_artifacts_pkey PRIMARY KEY (release_id, name),
  CONSTRAINT release_artifacts_release_id_fkey FOREIGN KEY (release_id)
    REFERENCES releases.releases(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT release_artifacts_digest_check CHECK (digest ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX release_artifacts_digest_idx ON releases.release_artifacts (digest);

CREATE FUNCTION releases.has_complete_artifact_set(release_identifier uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, releases
AS $$
  SELECT count(*) = 8
  FROM releases.release_artifacts
  WHERE release_id = release_identifier
$$;

CREATE FUNCTION releases.assert_release_artifacts_from_release()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, releases
AS $$
BEGIN
  IF NOT releases.has_complete_artifact_set(NEW.id) THEN
    RAISE EXCEPTION 'release artifact set must contain all eight artifacts'
      USING ERRCODE = '23514', CONSTRAINT = 'releases_complete_artifact_set_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION releases.assert_release_artifacts_from_artifact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, releases
AS $$
DECLARE
  release_identifier uuid := COALESCE(NEW.release_id, OLD.release_id);
BEGIN
  IF EXISTS (SELECT 1 FROM releases.releases WHERE id = release_identifier)
     AND NOT releases.has_complete_artifact_set(release_identifier) THEN
    RAISE EXCEPTION 'release artifact set must contain all eight artifacts'
      USING ERRCODE = '23514', CONSTRAINT = 'releases_complete_artifact_set_check';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER releases_complete_artifact_set_release_trigger
AFTER INSERT OR UPDATE ON releases.releases
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION releases.assert_release_artifacts_from_release();

CREATE CONSTRAINT TRIGGER releases_complete_artifact_set_artifact_trigger
AFTER INSERT OR UPDATE OR DELETE ON releases.release_artifacts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION releases.assert_release_artifacts_from_artifact();

-- Existing UUID references predate the catalog. New writes are enforced immediately;
-- historical rows can be reconciled before validating these constraints.
ALTER TABLE tenants.tenant_profiles
  ADD CONSTRAINT tenant_profiles_release_id_fkey
    FOREIGN KEY (release_id) REFERENCES releases.releases(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE infrastructure.capacity_reservations
  ADD CONSTRAINT capacity_reservations_release_id_fkey
    FOREIGN KEY (release_id) REFERENCES releases.releases(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

ALTER TABLE operations.provisioning_operations
  ADD CONSTRAINT provisioning_operations_release_id_fkey
    FOREIGN KEY (release_id) REFERENCES releases.releases(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT NOT VALID;

REVOKE ALL ON SCHEMA releases FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA releases FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA releases FROM PUBLIC;
REVOKE ALL ON FUNCTION releases.has_complete_artifact_set(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION releases.assert_release_artifacts_from_release() FROM PUBLIC;
REVOKE ALL ON FUNCTION releases.assert_release_artifacts_from_artifact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION releases.has_complete_artifact_set(uuid) TO qcrm_platform_runtime;
GRANT EXECUTE ON FUNCTION releases.assert_release_artifacts_from_release() TO qcrm_platform_runtime;
GRANT EXECUTE ON FUNCTION releases.assert_release_artifacts_from_artifact() TO qcrm_platform_runtime;
