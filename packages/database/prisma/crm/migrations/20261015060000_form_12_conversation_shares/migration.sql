-- FORM-12: a public, one-response capability tied to one contact and conversation.
CREATE TABLE forms.conversation_shares (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL,
  form_revision integer NOT NULL,
  contact_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  created_by_member_id uuid NOT NULL,
  response_id uuid UNIQUE,
  expires_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id, form_revision) REFERENCES forms.versions(form_id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (conversation_id) REFERENCES conversations.conversations(id) ON DELETE RESTRICT
);
CREATE INDEX form_conversation_shares_conversation_idx
  ON forms.conversation_shares(conversation_id, created_at DESC);

ALTER TABLE forms.responses ADD COLUMN conversation_id uuid;
ALTER TABLE forms.responses ADD CONSTRAINT form_response_conversation_fk
  FOREIGN KEY (conversation_id) REFERENCES conversations.conversations(id) ON DELETE RESTRICT;
CREATE INDEX form_responses_conversation_idx ON forms.responses(conversation_id, submitted_at DESC)
  WHERE conversation_id IS NOT NULL;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON forms.conversation_shares TO %I', runtime_role);
END $$;
