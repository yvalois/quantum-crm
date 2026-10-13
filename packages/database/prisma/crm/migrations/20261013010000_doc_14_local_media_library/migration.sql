-- DOC-14: allow tenant-local media assets without inventing a commercial document.
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
  OR (owner_kind = 'library' AND owner_module IS NULL AND owner_type IS NULL
    AND owner_id IS NULL AND attachment_claim_id IS NULL)
);

CREATE INDEX files_library_recent_idx ON files.files (updated_at DESC, id DESC)
  WHERE owner_kind = 'library';
