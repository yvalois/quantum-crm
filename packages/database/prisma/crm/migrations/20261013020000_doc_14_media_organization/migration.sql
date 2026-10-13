-- DOC-14: virtual organization; object keys and verified bytes remain immutable.
CREATE TABLE files.library_folders (
  id uuid PRIMARY KEY,
  owner_member_id uuid NOT NULL,
  parent_id uuid REFERENCES files.library_folders(id) ON DELETE RESTRICT,
  name varchar(80) NOT NULL,
  created_at timestamptz(6) NOT NULL,
  updated_at timestamptz(6) NOT NULL,
  CONSTRAINT library_folders_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT library_folders_not_self_check CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX library_folders_root_name_unique
  ON files.library_folders(owner_member_id, lower(name)) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX library_folders_child_name_unique
  ON files.library_folders(owner_member_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL;
CREATE INDEX library_folders_parent_idx ON files.library_folders(parent_id);

ALTER TABLE files.files
  ADD COLUMN library_folder_id uuid REFERENCES files.library_folders(id) ON DELETE RESTRICT,
  ADD COLUMN library_title varchar(255),
  ADD COLUMN library_tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE files.files ADD CONSTRAINT files_library_metadata_check CHECK (
  owner_kind = 'library'
  OR (library_folder_id IS NULL AND library_title IS NULL AND cardinality(library_tags) = 0)
);
ALTER TABLE files.files ADD CONSTRAINT files_library_tags_check CHECK (cardinality(library_tags) <= 12);
CREATE INDEX files_library_folder_recent_idx ON files.files(library_folder_id, updated_at DESC, id DESC)
  WHERE owner_kind = 'library';
CREATE INDEX files_library_tags_idx ON files.files USING GIN(library_tags)
  WHERE owner_kind = 'library';

DO $$
DECLARE runtime_role text := regexp_replace(current_database(), '^qcrm_t_', 'qcrm_r_');
BEGIN
  IF current_database() !~ '^qcrm_t_[0-9a-f]{32}$' OR runtime_role !~ '^qcrm_r_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'CRM migration requires a tenant database identity';
  END IF;
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON files.library_folders TO %I', runtime_role);
END $$;
