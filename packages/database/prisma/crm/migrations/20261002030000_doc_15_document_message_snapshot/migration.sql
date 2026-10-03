-- DOC-15: bind document conversation messages to an immutable server snapshot.
ALTER TABLE conversations.messages
  ADD COLUMN document_id uuid,
  ADD COLUMN document_snapshot jsonb;

ALTER TABLE conversations.messages
  ADD CONSTRAINT conversation_message_document_fk
    FOREIGN KEY (document_id) REFERENCES documents.documents(id) ON DELETE RESTRICT,
  ADD CONSTRAINT conversation_message_document_snapshot_check
    CHECK ((document_id IS NULL AND document_snapshot IS NULL)
      OR (document_id IS NOT NULL AND document_snapshot IS NOT NULL
          AND jsonb_typeof(document_snapshot) = 'object'));

CREATE INDEX conversation_messages_document_idx
  ON conversations.messages(document_id)
  WHERE document_id IS NOT NULL;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON conversations.messages TO %I', runtime_role);
END $$;
