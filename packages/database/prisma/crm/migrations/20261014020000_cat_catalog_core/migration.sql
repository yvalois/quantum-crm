-- CAT-01/03/05/13/16/17/18, CAL-12: aditive catalog and interval capacity.
CREATE SCHEMA catalog;

CREATE TABLE catalog.categories (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(120) NOT NULL,
  parent_id uuid REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_category_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT catalog_category_parent_check CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX catalog_category_name_parent_unique ON catalog.categories (lower(name), COALESCE(parent_id::text, ''));
CREATE INDEX catalog_category_parent_idx ON catalog.categories(parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE catalog.item_types (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(120) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_type_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX catalog_type_name_unique ON catalog.item_types(lower(name));

CREATE TABLE catalog.items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  kind varchar(16) NOT NULL,
  name varchar(180) NOT NULL,
  description text NOT NULL DEFAULT '',
  sku varchar(100),
  category_id uuid REFERENCES catalog.categories(id) ON DELETE RESTRICT,
  item_type_id uuid REFERENCES catalog.item_types(id) ON DELETE RESTRICT,
  price numeric(18, 4) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'GTQ',
  availability_mode varchar(20) NOT NULL,
  capacity integer,
  locks_advisor boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_item_kind_check CHECK (kind IN ('product', 'service')),
  CONSTRAINT catalog_item_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 180),
  CONSTRAINT catalog_item_description_check CHECK (length(description) <= 10000),
  CONSTRAINT catalog_item_price_check CHECK (price >= 0),
  CONSTRAINT catalog_item_mode_check CHECK (availability_mode IN ('unlimited', 'stock', 'interval_capacity')),
  CONSTRAINT catalog_item_capacity_check CHECK ((availability_mode = 'interval_capacity' AND capacity > 0) OR (availability_mode <> 'interval_capacity' AND capacity IS NULL)),
  CONSTRAINT catalog_item_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX catalog_item_sku_unique ON catalog.items(lower(sku)) WHERE sku IS NOT NULL;
CREATE INDEX catalog_items_browse_idx ON catalog.items(active DESC, kind, name, id);
CREATE INDEX catalog_items_category_idx ON catalog.items(category_id, name, id) WHERE category_id IS NOT NULL;
CREATE INDEX catalog_items_type_idx ON catalog.items(item_type_id, name, id) WHERE item_type_id IS NOT NULL;

CREATE TABLE catalog.field_definitions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  item_type_id uuid REFERENCES catalog.item_types(id) ON DELETE RESTRICT,
  item_id uuid REFERENCES catalog.items(id) ON DELETE RESTRICT,
  field_key varchar(80) NOT NULL,
  label varchar(160) NOT NULL,
  description varchar(500) NOT NULL DEFAULT '',
  value_type varchar(20) NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_field_scope_check CHECK (num_nonnulls(item_type_id, item_id) = 1),
  CONSTRAINT catalog_field_key_check CHECK (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  CONSTRAINT catalog_field_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  CONSTRAINT catalog_field_type_check CHECK (value_type IN ('text', 'number', 'date', 'boolean', 'single_select', 'multi_select', 'color')),
  CONSTRAINT catalog_field_options_check CHECK (jsonb_typeof(options) = 'array')
);
CREATE UNIQUE INDEX catalog_type_field_key_unique ON catalog.field_definitions(item_type_id, field_key) WHERE item_type_id IS NOT NULL;
CREATE UNIQUE INDEX catalog_item_field_key_unique ON catalog.field_definitions(item_id, field_key) WHERE item_id IS NOT NULL;
CREATE INDEX catalog_fields_item_idx ON catalog.field_definitions(item_id, sort_order, id) WHERE item_id IS NOT NULL;

CREATE TABLE catalog.field_values (
  item_id uuid NOT NULL REFERENCES catalog.items(id) ON DELETE RESTRICT,
  field_id uuid NOT NULL REFERENCES catalog.field_definitions(id) ON DELETE RESTRICT,
  value jsonb NOT NULL,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item_id, field_id)
);
CREATE INDEX catalog_field_values_field_idx ON catalog.field_values(field_id, item_id);

CREATE TABLE catalog.stock_movements (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  item_id uuid NOT NULL REFERENCES catalog.items(id) ON DELETE RESTRICT,
  delta integer NOT NULL,
  reason varchar(500) NOT NULL,
  actor_member_id uuid NOT NULL REFERENCES iam.members(id) ON DELETE RESTRICT,
  idempotency_key varchar(128) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_stock_delta_check CHECK (delta <> 0),
  CONSTRAINT catalog_stock_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  UNIQUE (item_id, actor_member_id, idempotency_key)
);
CREATE INDEX catalog_stock_movements_item_idx ON catalog.stock_movements(item_id, created_at DESC, id DESC);

CREATE TABLE catalog.capacity_reservations (
  calendar_event_id uuid PRIMARY KEY REFERENCES calendar.events(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES catalog.items(id) ON DELETE RESTRICT,
  starts_at timestamptz(6) NOT NULL,
  ends_at timestamptz(6) NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT catalog_reservation_range_check CHECK (starts_at < ends_at),
  CONSTRAINT catalog_reservation_quantity_check CHECK (quantity > 0)
);
CREATE INDEX catalog_capacity_period_idx ON catalog.capacity_reservations USING gist (item_id, tstzrange(starts_at, ends_at, '[)')) WHERE active;

ALTER TABLE calendar.calendars ADD COLUMN catalog_item_id uuid REFERENCES catalog.items(id) ON DELETE RESTRICT;
CREATE INDEX calendar_catalog_item_idx ON calendar.calendars(catalog_item_id) WHERE catalog_item_id IS NOT NULL;

ALTER TABLE calendar.events ADD COLUMN locks_advisor boolean NOT NULL DEFAULT true;
CREATE FUNCTION catalog.set_event_advisor_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_item uuid;
BEGIN
  SELECT catalog_item_id INTO linked_item FROM calendar.calendars WHERE id = NEW.calendar_id;
  IF linked_item IS NULL THEN
    NEW.locks_advisor := true;
  ELSE
    SELECT locks_advisor INTO NEW.locks_advisor FROM catalog.items WHERE id = linked_item;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_calendar_event_advisor_lock
  BEFORE INSERT OR UPDATE OF calendar_id ON calendar.events
  FOR EACH ROW EXECUTE FUNCTION catalog.set_event_advisor_lock();
ALTER TABLE calendar.events DROP CONSTRAINT calendar_events_no_overlap;
ALTER TABLE calendar.events ADD CONSTRAINT calendar_events_no_overlap EXCLUDE USING gist (
  advisor_member_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status IN ('pending', 'confirmed') AND locks_advisor);

CREATE FUNCTION catalog.sync_calendar_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linked_item uuid;
  item_capacity integer;
  item_mode varchar(20);
  item_kind varchar(16);
  item_active boolean;
  used_capacity integer;
BEGIN
  SELECT catalog_item_id INTO linked_item FROM calendar.calendars WHERE id = NEW.calendar_id;
  IF linked_item IS NULL THEN
    UPDATE catalog.capacity_reservations SET active = false, updated_at = CURRENT_TIMESTAMP
    WHERE calendar_event_id = NEW.id AND active;
    RETURN NEW;
  END IF;
  SELECT capacity, availability_mode, kind, active
    INTO item_capacity, item_mode, item_kind, item_active
    FROM catalog.items WHERE id = linked_item FOR UPDATE;
  IF item_kind <> 'service' OR NOT item_active OR item_mode = 'stock' THEN
    RAISE EXCEPTION 'Catalog item is not an active schedulable service' USING ERRCODE = '23514';
  END IF;
  IF item_mode = 'unlimited' THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('pending', 'confirmed') THEN
    UPDATE catalog.capacity_reservations SET active = false, updated_at = CURRENT_TIMESTAMP
    WHERE calendar_event_id = NEW.id AND active;
    RETURN NEW;
  END IF;
  SELECT COALESCE(sum(quantity), 0) INTO used_capacity
    FROM catalog.capacity_reservations
    WHERE item_id = linked_item AND active AND calendar_event_id <> NEW.id
      AND tstzrange(starts_at, ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)');
  IF used_capacity + 1 > item_capacity THEN
    RAISE EXCEPTION 'Catalog interval capacity exhausted' USING ERRCODE = '23P01';
  END IF;
  INSERT INTO catalog.capacity_reservations (calendar_event_id, item_id, starts_at, ends_at, quantity, active)
    VALUES (NEW.id, linked_item, NEW.starts_at, NEW.ends_at, 1, true)
    ON CONFLICT (calendar_event_id) DO UPDATE
      SET item_id = EXCLUDED.item_id, starts_at = EXCLUDED.starts_at,
          ends_at = EXCLUDED.ends_at, active = true, updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_calendar_event_reservation
  AFTER INSERT OR UPDATE OF calendar_id, starts_at, ends_at, status ON calendar.events
  FOR EACH ROW EXECUTE FUNCTION catalog.sync_calendar_reservation();

CREATE FUNCTION catalog.guard_calendar_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_kind varchar(16); linked_mode varchar(20); linked_active boolean;
BEGIN
  IF NEW.catalog_item_id IS NOT NULL THEN
    SELECT kind, availability_mode, active INTO linked_kind, linked_mode, linked_active
    FROM catalog.items WHERE id = NEW.catalog_item_id;
    IF linked_kind <> 'service' OR linked_mode = 'stock' OR NOT linked_active THEN
      RAISE EXCEPTION 'Calendar requires an active schedulable service' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.catalog_item_id IS DISTINCT FROM OLD.catalog_item_id AND EXISTS (
    SELECT 1 FROM calendar.events WHERE calendar_id = NEW.id AND status IN ('pending', 'confirmed')
  ) THEN
    RAISE EXCEPTION 'Cannot relink a calendar with active events' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_calendar_link_guard BEFORE INSERT OR UPDATE OF catalog_item_id ON calendar.calendars
  FOR EACH ROW EXECUTE FUNCTION catalog.guard_calendar_link();

ALTER TABLE iam.role_permissions DROP CONSTRAINT iam_role_permissions_permission_check;
ALTER TABLE iam.role_permissions ADD CONSTRAINT iam_role_permissions_permission_check CHECK (
  permission IN (
    'iam:members:read', 'iam:members:create', 'iam:members:update', 'iam:members:deactivate',
    'iam:members:export', 'iam:members:roles', 'iam:teams:read', 'iam:teams:create', 'iam:teams:update',
    'crm:contacts:read', 'crm:contacts:create', 'crm:contacts:update', 'crm:contacts:assign', 'crm:contacts:delete', 'crm:contacts:export',
    'crm:sales:read', 'crm:sales:create', 'crm:sales:update', 'crm:sales:assign', 'crm:sales:delete', 'crm:sales:export',
    'crm:sales:configure', 'crm:sales:move', 'crm:tasks:read', 'crm:tasks:create', 'crm:tasks:update',
    'crm:tasks:delete', 'crm:tasks:export', 'crm:calendar:read', 'crm:calendar:read-all', 'crm:calendar:create',
    'crm:calendar:update', 'crm:calendar:configure', 'crm:automations:read', 'crm:automations:execute',
    'crm:automations:configure', 'crm:conversations:read', 'crm:conversations:reply',
    'crm:conversations:assign', 'crm:conversations:control-agent', 'crm:conversations:configure',
    'crm:documents:read', 'crm:documents:create', 'crm:documents:update', 'crm:documents:templates',
    'crm:files:read', 'crm:files:upload', 'crm:files:reference', 'crm:files:download', 'crm:files:delete',
    'crm:forms:read', 'crm:forms:write', 'crm:forms:publish', 'crm:forms:responses',
    'crm:catalog:read', 'crm:catalog:write', 'crm:catalog:stock'
  )
);
INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, permission.code FROM iam.roles AS role
CROSS JOIN (VALUES ('crm:catalog:read'), ('crm:catalog:write'), ('crm:catalog:stock')) AS permission(code)
WHERE role.code IN ('ADMINISTRATOR', 'SUPERVISOR') ON CONFLICT DO NOTHING;
INSERT INTO iam.role_permissions (role_id, permission)
SELECT role.id, 'crm:catalog:read' FROM iam.roles AS role WHERE role.code = 'ADVISOR' ON CONFLICT DO NOTHING;
UPDATE iam.roles SET authorization_revision = authorization_revision + 1, updated_at = CURRENT_TIMESTAMP
WHERE code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR');
UPDATE iam.members AS member SET authorization_revision = member.authorization_revision + 1, updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM iam.member_roles AS assignment JOIN iam.roles AS role ON role.id = assignment.role_id
              WHERE assignment.member_id = member.id AND role.code IN ('ADMINISTRATOR', 'SUPERVISOR', 'ADVISOR'));

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA catalog TO %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalog TO %I', runtime_role);
END $$;
