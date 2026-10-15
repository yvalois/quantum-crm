-- Hide old messages in one conversation without destroying delivery, media or audit records.
ALTER TABLE conversations.conversations
  ADD COLUMN visible_after_sequence bigint NOT NULL DEFAULT 0,
  ADD COLUMN visible_cleared_at timestamptz(6),
  ADD CONSTRAINT conversations_visible_after_sequence_check CHECK (visible_after_sequence >= 0);
