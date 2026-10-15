-- USR-06 / CHAT-07 / CON-06 / PIPE-06: tenant-local, idempotent owner backfill.
-- The caller must create TEMP TABLE qcrm_owner_map(source_location_id text,
-- external_id text, member_id uuid) in this psql
-- session. Never commit real mapping identifiers to this repository.
-- Invoke with -v ON_ERROR_STOP=1 -v qcrm_apply=0 for a rolled-back preview;
-- then -v qcrm_apply=1 for the same input only after inspecting counts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Owner reconciliation requires a tenant database';
  END IF;
  IF (SELECT count(*) FROM qcrm_owner_map) = 0
     OR (SELECT count(*) FROM qcrm_owner_map) <> (SELECT count(DISTINCT external_id) FROM qcrm_owner_map)
     OR (SELECT count(*) FROM qcrm_owner_map) <> (SELECT count(DISTINCT member_id) FROM qcrm_owner_map)
     OR (SELECT count(DISTINCT source_location_id) FROM qcrm_owner_map) <> 1 THEN
    RAISE EXCEPTION 'Owner mapping is empty, duplicated or spans locations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM qcrm_owner_map AS mapping
    LEFT JOIN iam.members AS member ON member.id = mapping.member_id
    LEFT JOIN iam.member_roles AS assignment ON assignment.member_id = member.id
    LEFT JOIN iam.roles AS role ON role.id = assignment.role_id AND role.code = 'ADVISOR'
    LEFT JOIN iam.external_participants AS participant
      ON participant.source_system = 'GHL'
      AND participant.source_location_id = mapping.source_location_id
      AND participant.external_id = mapping.external_id
    WHERE member.id IS NULL OR member.status NOT IN ('invited', 'active')
      OR role.id IS NULL OR participant.external_id IS NULL
      OR lower(participant.display_name) <> lower(member.display_name)
  ) THEN
    RAISE EXCEPTION 'Mapping does not match an invited/active advisor and source participant';
  END IF;
END $$;

CREATE TEMP TABLE qcrm_changed_contacts ON COMMIT DROP AS
WITH changed AS (
  UPDATE contacts.contacts AS contact
  SET owner_member_id = mapping.member_id,
      version = contact.version + 1,
      updated_at = clock_timestamp()
  FROM contacts.historical_imports AS source, qcrm_owner_map AS mapping
  WHERE source.entity_type = 'contact' AND source.source_system = 'GHL'
    AND source.source_location_id = mapping.source_location_id
    AND source.source_payload->>'assignedTo' = mapping.external_id
    AND source.entity_id = contact.id AND contact.owner_member_id IS NULL
  RETURNING contact.id, mapping.member_id
)
SELECT * FROM changed;

UPDATE contacts.historical_imports AS source
SET result_metadata = jsonb_set(source.result_metadata, '{ownerReconciliation}',
  jsonb_build_object('memberId', changed.member_id, 'previousMemberId', NULL,
                     'reconciledAt', clock_timestamp(), 'method', 'exact-source-id'), true)
FROM qcrm_changed_contacts AS changed
WHERE source.entity_type = 'contact' AND source.entity_id = changed.id;

CREATE TEMP TABLE qcrm_changed_threads ON COMMIT DROP AS
WITH changed AS (
  UPDATE conversations.historical_threads AS thread
  SET assignee_member_id = mapping.member_id
  FROM conversations.historical_imports AS source, qcrm_owner_map AS mapping
  WHERE source.entity_type = 'thread' AND source.source_system = 'GHL'
    AND source.source_location_id = mapping.source_location_id
    AND source.source_payload->>'assignedTo' = mapping.external_id
    AND source.entity_id = thread.id AND thread.assignee_member_id IS NULL
  RETURNING thread.id, mapping.member_id
)
SELECT * FROM changed;

UPDATE conversations.historical_imports AS source
SET result_metadata = jsonb_set(source.result_metadata, '{ownerReconciliation}',
  jsonb_build_object('memberId', changed.member_id, 'previousMemberId', NULL,
                     'reconciledAt', clock_timestamp(), 'method', 'exact-source-id'), true)
FROM qcrm_changed_threads AS changed
WHERE source.entity_type = 'thread' AND source.entity_id = changed.id;

CREATE TEMP TABLE qcrm_changed_opportunities ON COMMIT DROP AS
WITH changed AS (
  UPDATE sales.opportunities AS opportunity
  SET owner_member_id = mapping.member_id,
      version = opportunity.version + 1,
      updated_at = clock_timestamp()
  FROM sales.historical_imports AS source, qcrm_owner_map AS mapping
  WHERE source.entity_type = 'opportunity' AND source.source_system = 'GHL'
    AND source.source_location_id = mapping.source_location_id
    AND source.source_payload->>'assignedTo' = mapping.external_id
    AND source.entity_id = opportunity.id
    AND opportunity.owner_member_id = source.actor_member_id
  RETURNING opportunity.id, mapping.member_id, source.actor_member_id AS previous_member_id
)
SELECT * FROM changed;

INSERT INTO sales.opportunity_history
  (opportunity_id, event_type, actor_member_id, previous_owner_member_id,
   next_owner_member_id, note)
SELECT id, 'owner_changed', previous_member_id, previous_member_id,
       member_id, 'Responsable conciliado por ID exacto del origen GHL'
FROM qcrm_changed_opportunities;

UPDATE sales.historical_imports AS source
SET result_metadata = jsonb_set(source.result_metadata, '{ownerReconciliation}',
  jsonb_build_object('memberId', changed.member_id,
                     'previousMemberId', changed.previous_member_id,
                     'reconciledAt', clock_timestamp(), 'method', 'exact-source-id'), true)
FROM qcrm_changed_opportunities AS changed
WHERE source.entity_type = 'opportunity' AND source.entity_id = changed.id;

SELECT 'contacts' AS entity, count(*) AS changed FROM qcrm_changed_contacts
UNION ALL SELECT 'threads', count(*) FROM qcrm_changed_threads
UNION ALL SELECT 'opportunities', count(*) FROM qcrm_changed_opportunities;

\if :qcrm_apply
COMMIT;
\else
ROLLBACK;
\endif
