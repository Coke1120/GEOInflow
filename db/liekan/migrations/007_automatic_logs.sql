CREATE TABLE liekan_log_state (
  website_id uuid PRIMARY KEY,
  epoch integer NOT NULL DEFAULT 1,
  data_revision bigint NOT NULL DEFAULT 0,
  policy_revision bigint NOT NULL DEFAULT 0,
  reset_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE liekan_log_source (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('server','cloudflare')),
  domain text NOT NULL,
  created_by uuid NOT NULL,
  owner_id uuid,
  team_id uuid,
  state text NOT NULL DEFAULT 'configuring' CHECK (state IN ('configuring','active','paused','disconnected','error')),
  credential_hash varchar(64),
  credential_version integer NOT NULL DEFAULT 1,
  requested_policy_revision bigint NOT NULL DEFAULT 0,
  provider_config text,
  provider_job_id text,
  provider_lease uuid,
  provider_lease_until timestamptz,
  last_maintenance_at timestamptz,
  last_permission_check_at timestamptz,
  last_heartbeat_at timestamptz,
  last_received_at timestamptz,
  last_processed_at timestamptz,
  last_test_at timestamptz,
  error_code text,
  health jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (website_id,id)
);
CREATE INDEX liekan_log_source_permission_check ON liekan_log_source(last_permission_check_at) WHERE state IN ('active','configuring');
CREATE INDEX liekan_log_source_website ON liekan_log_source(website_id,state);
CREATE TABLE liekan_log_interval (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES liekan_log_source(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at>=starts_at)
);
CREATE UNIQUE INDEX liekan_one_active_log_source ON liekan_log_interval(website_id) WHERE ends_at IS NULL;
CREATE INDEX liekan_log_interval_time ON liekan_log_interval(website_id,starts_at,ends_at,source_id);
CREATE TABLE liekan_log_grant (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  created_by uuid NOT NULL,
  domain text NOT NULL,
  epoch integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pairing','oauth')),
  secret_hash varchar(64) NOT NULL UNIQUE,
  browser_hash varchar(64),
  payload text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  source_id uuid REFERENCES liekan_log_source(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE liekan_ingest_batch (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES liekan_log_source(id),
  epoch integer NOT NULL,
  digest varchar(64) NOT NULL,
  payload jsonb,
  received integer NOT NULL,
  valid integer NOT NULL,
  rejected integer NOT NULL,
  inserted integer NOT NULL DEFAULT 0,
  duplicates integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]',
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processed','cancelled','failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (source_id,digest)
);
CREATE INDEX liekan_ingest_backlog ON liekan_ingest_batch(website_id,received_at) WHERE state='pending';
CREATE INDEX liekan_batch_website_received ON liekan_ingest_batch(website_id,received_at);
CREATE INDEX liekan_batch_retention ON liekan_ingest_batch(received_at);
CREATE TABLE liekan_worker_state (
  id text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  version text NOT NULL
);
CREATE TABLE liekan_queue_installation (
  id text PRIMARY KEY,
  package_version text NOT NULL,
  checksum varchar(64) NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE liekan_bot_snapshot (
  bot text PRIMARY KEY,
  source_url text NOT NULL,
  prefixes jsonb NOT NULL,
  retrieved_at timestamptz NOT NULL,
  version varchar(64) NOT NULL,
  error_code text
);
ALTER TABLE liekan_import ADD COLUMN kind text NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','automatic'));
ALTER TABLE liekan_import ADD COLUMN source_id uuid REFERENCES liekan_log_source(id);
ALTER TABLE liekan_import ADD COLUMN inserted integer;
ALTER TABLE liekan_log ADD COLUMN source_id uuid REFERENCES liekan_log_source(id);
ALTER TABLE liekan_log ADD COLUMN event_digest varchar(64);
ALTER TABLE liekan_log ADD COLUMN verification_version varchar(64);
CREATE INDEX liekan_log_source_date ON liekan_log(website_id,source_id,created_at);
CREATE VIEW liekan_effective_log AS
SELECT l.* FROM liekan_log l WHERE
  (l.source_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM liekan_log_interval i WHERE i.website_id=l.website_id
      AND l.created_at>=i.starts_at AND (i.ends_at IS NULL OR l.created_at<i.ends_at)
  )) OR
  (l.source_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM liekan_log_interval i WHERE i.website_id=l.website_id AND i.source_id=l.source_id
      AND l.created_at>=i.starts_at AND (i.ends_at IS NULL OR l.created_at<i.ends_at)
  ));
