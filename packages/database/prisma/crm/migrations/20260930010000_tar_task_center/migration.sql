-- TAR-01-12: additive task center metadata, comments and durable history.
ALTER TABLE tasks.tasks
  ADD COLUMN type varchar(16) NOT NULL DEFAULT 'other',
  ADD COLUMN origin varchar(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN completed_at timestamptz(6),
  ADD COLUMN completed_by_member_id uuid,
  ADD CONSTRAINT tasks_type_check
    CHECK (type IN ('call', 'message', 'meeting', 'quote', 'collection', 'other')),
  ADD CONSTRAINT tasks_origin_check
    CHECK (origin IN ('manual', 'automation', 'agent'));

UPDATE tasks.tasks
SET completed_at = updated_at,
    completed_by_member_id = created_by_member_id
WHERE status IN ('completed', 'cancelled');

ALTER TABLE tasks.tasks
  ADD CONSTRAINT tasks_completion_check
    CHECK (
      (status IN ('completed', 'cancelled') AND completed_at IS NOT NULL AND completed_by_member_id IS NOT NULL)
      OR (status IN ('pending', 'in_progress') AND completed_at IS NULL AND completed_by_member_id IS NULL)
    );

CREATE INDEX tasks_filter_idx
  ON tasks.tasks(status, priority, type, due_at, assignee_member_id, id);
CREATE INDEX tasks_contact_open_idx
  ON tasks.tasks(contact_id, due_at, id)
  WHERE status IN ('pending', 'in_progress');

CREATE TABLE tasks.comments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  task_id uuid NOT NULL REFERENCES tasks.tasks(id) ON DELETE RESTRICT,
  author_member_id uuid NOT NULL,
  body varchar(4000) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tasks_comment_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 4000)
);

CREATE INDEX tasks_comments_task_created_idx
  ON tasks.comments(task_id, created_at ASC, id ASC);

CREATE TABLE tasks.history (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  task_id uuid NOT NULL REFERENCES tasks.tasks(id) ON DELETE RESTRICT,
  event_type varchar(32) NOT NULL,
  actor_member_id uuid NOT NULL,
  note varchar(4000),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tasks_history_event_check
    CHECK (event_type IN ('created', 'updated', 'assignee_changed', 'status_changed', 'commented')),
  CONSTRAINT tasks_history_note_check CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 4000)
);

CREATE INDEX tasks_history_task_created_idx
  ON tasks.history(task_id, created_at DESC, id DESC);

INSERT INTO tasks.history (task_id, event_type, actor_member_id, note, created_at)
SELECT id, 'created', created_by_member_id, 'Historia inicial importada', created_at
FROM tasks.tasks;

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT ON tasks.comments, tasks.history TO %I', runtime_role);
END $$;
