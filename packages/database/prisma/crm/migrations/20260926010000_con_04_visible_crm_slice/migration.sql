-- CON-04-a: additive, forward-only commercial slice. Each schema has one owner.
CREATE SCHEMA contacts;
CREATE SCHEMA sales;
CREATE SCHEMA tasks;

-- Extend the existing typed IAM catalogue before assigning commercial roles.
-- This migration is only ever applied through the per-tenant forward-only
-- history, so the constraint change cannot silently alter prior histories.
ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:configure', 'crm:sales:move',
    'crm:tasks:read', 'crm:tasks:create', 'crm:tasks:update'
  )
);

CREATE TABLE contacts.contacts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_member_id uuid NOT NULL,
  display_name varchar(160) NOT NULL,
  email citext,
  phone varchar(40),
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT contacts_display_name_check CHECK (length(btrim(display_name)) > 0)
);
CREATE INDEX contacts_owner_created_idx ON contacts.contacts(owner_member_id, created_at, id);

CREATE TABLE contacts.command_idempotency (
  actor_member_id uuid NOT NULL,
  command varchar(64) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_member_id, command, idempotency_key)
);

CREATE TABLE sales.pipelines (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(160) NOT NULL UNIQUE,
  description varchar(2000) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_pipeline_name_check CHECK (length(btrim(name)) > 0)
);
CREATE TABLE sales.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  pipeline_id uuid NOT NULL REFERENCES sales.pipelines(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  description varchar(2000) NOT NULL,
  position integer NOT NULL,
  CONSTRAINT sales_stage_position_check CHECK (position >= 0),
  CONSTRAINT sales_stage_position_unique UNIQUE (pipeline_id, position)
);
CREATE TABLE sales.opportunities (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_member_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  pipeline_id uuid NOT NULL REFERENCES sales.pipelines(id) ON DELETE RESTRICT,
  stage_id uuid NOT NULL REFERENCES sales.pipeline_stages(id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_opportunity_amount_check CHECK (amount_minor >= 0),
  CONSTRAINT sales_opportunity_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);
CREATE INDEX sales_opportunities_contact_idx ON sales.opportunities(contact_id, created_at, id);
CREATE INDEX sales_opportunities_owner_created_idx ON sales.opportunities(owner_member_id, created_at, id);

CREATE TABLE sales.command_idempotency (
  actor_member_id uuid NOT NULL,
  command varchar(64) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_member_id, command, idempotency_key)
);

CREATE TABLE tasks.tasks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  created_by_member_id uuid NOT NULL,
  contact_id uuid,
  opportunity_id uuid,
  assignee_member_id uuid NOT NULL,
  title varchar(200) NOT NULL,
  description varchar(4000) NOT NULL,
  priority varchar(10) NOT NULL,
  due_at timestamptz(6) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tasks_link_check CHECK ((contact_id IS NOT NULL) <> (opportunity_id IS NOT NULL)),
  CONSTRAINT tasks_priority_check CHECK (priority IN ('low', 'medium', 'high')),
  CONSTRAINT tasks_status_check CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'))
);
CREATE INDEX tasks_assignee_status_due_idx ON tasks.tasks(assignee_member_id, status, due_at, id);
CREATE INDEX tasks_creator_created_idx ON tasks.tasks(created_by_member_id, created_at, id);

CREATE TABLE tasks.command_idempotency (
  actor_member_id uuid NOT NULL,
  command varchar(64) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (actor_member_id, command, idempotency_key)
);

INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, permissions.permission
FROM iam.roles AS role
CROSS JOIN LATERAL (VALUES
  ('ADMINISTRATOR', 'crm:contacts:read'), ('ADMINISTRATOR', 'crm:contacts:create'), ('ADMINISTRATOR', 'crm:contacts:update'),
  ('ADMINISTRATOR', 'crm:sales:read'), ('ADMINISTRATOR', 'crm:sales:create'), ('ADMINISTRATOR', 'crm:sales:configure'), ('ADMINISTRATOR', 'crm:sales:move'),
  ('ADMINISTRATOR', 'crm:tasks:read'), ('ADMINISTRATOR', 'crm:tasks:create'), ('ADMINISTRATOR', 'crm:tasks:update'),
  ('SUPERVISOR', 'crm:contacts:read'), ('SUPERVISOR', 'crm:contacts:create'), ('SUPERVISOR', 'crm:contacts:update'),
  ('SUPERVISOR', 'crm:sales:read'), ('SUPERVISOR', 'crm:sales:create'), ('SUPERVISOR', 'crm:sales:move'),
  ('SUPERVISOR', 'crm:tasks:read'), ('SUPERVISOR', 'crm:tasks:create'), ('SUPERVISOR', 'crm:tasks:update'),
  ('ADVISOR', 'crm:contacts:read'), ('ADVISOR', 'crm:contacts:create'), ('ADVISOR', 'crm:contacts:update'),
  ('ADVISOR', 'crm:sales:read'), ('ADVISOR', 'crm:sales:create'), ('ADVISOR', 'crm:sales:move'),
  ('ADVISOR', 'crm:tasks:read'), ('ADVISOR', 'crm:tasks:create'), ('ADVISOR', 'crm:tasks:update')
) AS permissions(role_code, permission)
WHERE role.code = permissions.role_code
ON CONFLICT DO NOTHING;

-- Commercial scope is derived from the role server-side. Supervisors and
-- advisors do not gain the still-unimplemented member directory capability.
DELETE FROM iam.role_permissions permission
USING iam.roles role
WHERE permission.role_id = role.id
  AND role.code IN ('SUPERVISOR', 'ADVISOR')
  AND permission.permission = 'iam:members:read';

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN RAISE EXCEPTION 'CRM migration requires a tenant database identity'; END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA contacts, sales, tasks TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA contacts, sales, tasks TO %I', runtime_role);
END $$;
