-- CON-02: labels are owned by the contacts module and isolated per CRM database.
CREATE TABLE contacts.labels (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name varchar(80) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT contacts_label_name_check CHECK (length(btrim(name)) > 0),
  CONSTRAINT contacts_label_name_unique UNIQUE (name)
);

CREATE TABLE contacts.contact_labels (
  contact_id uuid NOT NULL REFERENCES contacts.contacts(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES contacts.labels(id) ON DELETE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contact_id, label_id)
);

CREATE INDEX contacts_contact_labels_label_idx ON contacts.contact_labels(label_id, contact_id);

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE contacts.labels, contacts.contact_labels TO %I', runtime_role);
END $$;
