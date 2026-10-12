ALTER TABLE conversations.conversations
  ADD COLUMN agent_reset_sequence bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT conversations_agent_reset_sequence_check CHECK (agent_reset_sequence >= 0);

-- Preserve the meaning of resets performed before the sequence marker existed.
UPDATE conversations.conversations AS conversation
SET agent_reset_sequence = COALESCE((
  SELECT MAX(message.sequence)
  FROM conversations.messages AS message
  WHERE message.conversation_id = conversation.id
    AND message.created_at <= conversation.agent_reset_at
), 0)
WHERE conversation.agent_reset_at IS NOT NULL;
