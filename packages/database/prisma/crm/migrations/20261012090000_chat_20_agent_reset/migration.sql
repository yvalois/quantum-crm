ALTER TABLE conversations.conversations
  ADD COLUMN agent_reset_at timestamptz(6);

ALTER TABLE conversations.history
  DROP CONSTRAINT conversation_history_event_check;

ALTER TABLE conversations.history
  ADD CONSTRAINT conversation_history_event_check
  CHECK (event_type IN ('created', 'assigned', 'transferred', 'status_changed', 'attention_changed', 'agent_reset', 'message_added', 'note_added'));
