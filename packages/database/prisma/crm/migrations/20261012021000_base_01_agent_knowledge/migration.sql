-- BASE-01: versioned, profile-local RAG sources. Files remain the sole object owner.
CREATE SCHEMA agents;

CREATE TABLE agents.knowledge_sources (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  catalog varchar(16) NOT NULL CHECK (catalog IN ('individual', 'corporativo')),
  file_id uuid UNIQUE REFERENCES files.files(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
  active boolean NOT NULL DEFAULT false,
  revision char(44),
  created_by_member_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at timestamptz(6),
  CONSTRAINT knowledge_source_active_check CHECK (
    NOT active OR (status = 'ready' AND file_id IS NOT NULL AND revision IS NOT NULL)
  )
);
CREATE UNIQUE INDEX knowledge_source_active_catalog_idx
  ON agents.knowledge_sources(catalog) WHERE active;
CREATE INDEX knowledge_source_status_idx ON agents.knowledge_sources(status, updated_at, id);

CREATE TABLE agents.knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  source_id uuid NOT NULL REFERENCES agents.knowledge_sources(id) ON DELETE RESTRICT,
  page integer NOT NULL CHECK (page BETWEEN 1 AND 1000),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 1000),
  content varchar(4000) NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  search_text tsvector GENERATED ALWAYS AS (to_tsvector('spanish', content)) STORED,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, page, ordinal)
);
CREATE INDEX knowledge_chunks_search_idx ON agents.knowledge_chunks USING gin(search_text);
CREATE INDEX knowledge_chunks_source_idx ON agents.knowledge_chunks(source_id, page, ordinal);

-- The conversations module owns the durable trigger and the outbound effect.
CREATE TABLE conversations.agent_requests (
  inbound_message_id uuid PRIMARY KEY REFERENCES conversations.messages(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL REFERENCES conversations.conversations(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'completed', 'cancelled', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  lease_owner varchar(120),
  lease_expires_at timestamptz(6),
  lease_generation bigint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  response_message_id uuid UNIQUE REFERENCES conversations.messages(id) ON DELETE RESTRICT,
  source_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_ids) = 'array'),
  failure_code varchar(80),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX agent_requests_pending_idx
  ON conversations.agent_requests(status, next_attempt_at, created_at, inbound_message_id)
  WHERE status IN ('pending', 'leased');

ALTER TABLE files.files DROP CONSTRAINT files_owner_check;
ALTER TABLE files.files ADD CONSTRAINT files_owner_check CHECK (
  (owner_kind = 'existing' AND attachment_claim_id IS NULL AND owner_id IS NOT NULL AND (
    (owner_module = 'documents' AND owner_type IN ('commercial_document', 'document_template'))
    OR (owner_module = 'conversations' AND owner_type IN ('conversation', 'message', 'historical_attachment'))
    OR (owner_module = 'forms' AND owner_type = 'form_response')
    OR (owner_module = 'catalog' AND owner_type IN ('product', 'variant'))
    OR (owner_module = 'agents' AND owner_type = 'knowledge_source')
  ))
  OR (owner_kind = 'claim' AND owner_module IS NULL AND owner_type IS NULL
    AND owner_id IS NULL AND attachment_claim_id IS NOT NULL)
);
ALTER TABLE files.references DROP CONSTRAINT file_references_module_check;
ALTER TABLE files.references ADD CONSTRAINT file_references_module_check CHECK (
  (module = 'documents' AND resource_type IN ('commercial_document', 'document_template'))
  OR (module = 'conversations' AND resource_type IN ('conversation', 'message', 'historical_attachment'))
  OR (module = 'forms' AND resource_type = 'form_response')
  OR (module = 'catalog' AND resource_type IN ('product', 'variant'))
  OR (module = 'agents' AND resource_type = 'knowledge_source')
);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA agents TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON agents.knowledge_sources, agents.knowledge_chunks TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON conversations.agent_requests TO %I', runtime_role);
END $$;
