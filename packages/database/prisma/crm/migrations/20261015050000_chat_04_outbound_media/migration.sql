-- CHAT-04: a message references one immutable, validated Files object.
ALTER TABLE conversations.messages
  ADD COLUMN file_id uuid REFERENCES files.files(id) ON DELETE RESTRICT;

ALTER TABLE conversations.messages
  ADD CONSTRAINT conversation_message_media_file_check CHECK (
    file_id IS NULL OR kind IN ('image', 'audio', 'document')
  );

CREATE INDEX conversation_messages_file_idx
  ON conversations.messages(file_id) WHERE file_id IS NOT NULL;
