ALTER TABLE sales.opportunities
  ADD COLUMN status varchar(16) NOT NULL DEFAULT 'open',
  ADD COLUMN close_reason varchar(2000),
  ADD COLUMN closed_at timestamptz(6),
  ADD CONSTRAINT sales_opportunity_status_check
    CHECK (status IN ('open', 'won', 'lost', 'abandoned')),
  ADD CONSTRAINT sales_opportunity_close_reason_check
    CHECK (
      (status IN ('lost', 'abandoned') AND close_reason IS NOT NULL AND length(btrim(close_reason)) > 0)
      OR (status IN ('open', 'won') AND close_reason IS NULL)
    ),
  ADD CONSTRAINT sales_opportunity_closed_at_check
    CHECK ((status = 'open' AND closed_at IS NULL) OR (status <> 'open' AND closed_at IS NOT NULL));

CREATE INDEX sales_opportunities_pipeline_stage_status_idx
  ON sales.opportunities(pipeline_id, stage_id, status, updated_at DESC, id DESC);
CREATE INDEX sales_opportunities_status_owner_idx
  ON sales.opportunities(status, owner_member_id, updated_at DESC, id DESC);

CREATE TABLE sales.opportunity_history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  opportunity_id uuid NOT NULL REFERENCES sales.opportunities(id) ON DELETE RESTRICT,
  event_type varchar(32) NOT NULL,
  actor_member_id uuid NOT NULL,
  previous_stage_id uuid,
  next_stage_id uuid,
  previous_owner_member_id uuid,
  next_owner_member_id uuid,
  previous_status varchar(16),
  next_status varchar(16),
  previous_amount_minor bigint,
  next_amount_minor bigint,
  note varchar(2000),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_opportunity_history_event_check
    CHECK (event_type IN ('created', 'stage_changed', 'updated', 'status_changed', 'owner_changed')),
  CONSTRAINT sales_opportunity_history_previous_status_check
    CHECK (previous_status IS NULL OR previous_status IN ('open', 'won', 'lost', 'abandoned')),
  CONSTRAINT sales_opportunity_history_next_status_check
    CHECK (next_status IS NULL OR next_status IN ('open', 'won', 'lost', 'abandoned')),
  CONSTRAINT sales_opportunity_history_previous_amount_check
    CHECK (previous_amount_minor IS NULL OR previous_amount_minor >= 0),
  CONSTRAINT sales_opportunity_history_next_amount_check
    CHECK (next_amount_minor IS NULL OR next_amount_minor >= 0)
);

CREATE INDEX sales_opportunity_history_opportunity_created_idx
  ON sales.opportunity_history(opportunity_id, created_at DESC, id DESC);

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:sales:update'
FROM iam.roles AS role
WHERE role.code IN ('SUPERVISOR', 'ADVISOR')
ON CONFLICT DO NOTHING;
