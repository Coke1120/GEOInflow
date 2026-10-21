SET LOCAL lock_timeout TO '5s';

CREATE TABLE liekan_crawler_registry_version (
  version uuid PRIMARY KEY,
  revision bigint NOT NULL UNIQUE CHECK (revision > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor_id uuid,
  action text NOT NULL CHECK (action IN ('seed','publish','rollback')),
  operation_id uuid UNIQUE,
  source_version uuid REFERENCES liekan_crawler_registry_version(version),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE liekan_crawler_registry_current (
  id smallint PRIMARY KEY CHECK (id = 1),
  version uuid NOT NULL REFERENCES liekan_crawler_registry_version(version),
  revision bigint NOT NULL CHECK (revision > 0),
  seed_hash text NOT NULL CHECK (seed_hash ~ '^[a-f0-9]{64}$'),
  seed_payload jsonb NOT NULL CHECK (jsonb_typeof(seed_payload) = 'object')
);
CREATE TABLE liekan_crawler_registry_draft (
  id uuid PRIMARY KEY,
  title varchar(160) NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  base_version uuid NOT NULL REFERENCES liekan_crawler_registry_version(version),
  base_revision bigint NOT NULL CHECK (base_revision > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conflicts) = 'array'),
  preview jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  source_action text NOT NULL DEFAULT 'publish' CHECK (source_action IN ('publish','rollback')),
  source_version uuid REFERENCES liekan_crawler_registry_version(version),
  seed_hash text UNIQUE,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX liekan_crawler_registry_draft_status_time ON liekan_crawler_registry_draft(status, updated_at DESC);
CREATE TABLE liekan_crawler_registry_operation (
  operation_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('createDraft','updateDraft','preview','publish','rollbackDraft')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION liekan_crawler_registry_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published crawler versions and operation receipts are immutable';
END;
$$;
CREATE TRIGGER liekan_crawler_registry_version_immutable BEFORE UPDATE OR DELETE ON liekan_crawler_registry_version
  FOR EACH ROW EXECUTE FUNCTION liekan_crawler_registry_immutable();
CREATE TRIGGER liekan_crawler_registry_operation_immutable BEFORE UPDATE OR DELETE ON liekan_crawler_registry_operation
  FOR EACH ROW EXECUTE FUNCTION liekan_crawler_registry_immutable();

CREATE FUNCTION liekan_crawler_registry_pointer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM liekan_crawler_registry_version WHERE version = NEW.version AND revision = NEW.revision) THEN
    RAISE EXCEPTION 'Crawler pointer must reference its complete immutable version';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.revision < OLD.revision OR (NEW.version <> OLD.version AND NEW.revision <> OLD.revision + 1)) THEN
    RAISE EXCEPTION 'Crawler publication revision must advance exactly once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER liekan_crawler_registry_pointer_guard BEFORE INSERT OR UPDATE ON liekan_crawler_registry_current
  FOR EACH ROW EXECUTE FUNCTION liekan_crawler_registry_pointer_guard();
