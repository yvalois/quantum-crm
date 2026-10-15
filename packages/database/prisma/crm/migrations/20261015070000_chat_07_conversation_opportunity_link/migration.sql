ALTER TABLE sales.opportunities
  ADD COLUMN source_conversation_id uuid;

CREATE UNIQUE INDEX sales_opportunities_source_conversation_unique
  ON sales.opportunities (source_conversation_id)
  WHERE source_conversation_id IS NOT NULL;
