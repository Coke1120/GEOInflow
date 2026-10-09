CREATE TABLE liekan_crawler_instance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  control_paused boolean NOT NULL DEFAULT true
);
INSERT INTO liekan_crawler_instance(singleton) VALUES(true);

CREATE TABLE liekan_crawler_state (
  website_id uuid PRIMARY KEY,
  generation integer NOT NULL DEFAULT 1,
  critical_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE liekan_crawler_connection (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES liekan_crawler_state(website_id),
  created_by uuid NOT NULL,
  owner_user_id uuid,
  team_id uuid,
  domain text NOT NULL,
  zone_id varchar(32) NOT NULL,
  token_encrypted text,
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','frozen','disconnected','cleanup')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  cleanup_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX liekan_crawler_one_connection ON liekan_crawler_connection(website_id) WHERE state='active';

CREATE TABLE liekan_crawler_policy (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES liekan_crawler_state(website_id),
  connection_id uuid REFERENCES liekan_crawler_connection(id),
  version integer NOT NULL DEFAULT 1,
  generation integer NOT NULL DEFAULT 1,
  body jsonb NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','enabled','stopped')),
  ref varchar(64) NOT NULL UNIQUE,
  remote_ruleset_id varchar(32),
  remote_rule_id varchar(32),
  remote_hash varchar(64),
  applied_version integer,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX liekan_crawler_policies_website ON liekan_crawler_policy(website_id,created_at,id);

CREATE TABLE liekan_crawler_policy_version (
  policy_id uuid NOT NULL REFERENCES liekan_crawler_policy(id),
  version integer NOT NULL,
  body jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(policy_id,version)
);

CREATE TABLE liekan_crawler_preview (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES liekan_crawler_policy(id),
  connection_id uuid REFERENCES liekan_crawler_connection(id),
  actor_id uuid NOT NULL,
  generation integer NOT NULL,
  policy_version integer NOT NULL,
  operation text NOT NULL CHECK(operation IN ('deploy','stop','rollback','cleanup')),
  payload jsonb NOT NULL,
  fingerprint varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX liekan_crawler_previews_expiry ON liekan_crawler_preview(expires_at);

CREATE TABLE liekan_crawler_deployment (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES liekan_crawler_policy(id),
  connection_id uuid REFERENCES liekan_crawler_connection(id),
  preview_id uuid NOT NULL UNIQUE REFERENCES liekan_crawler_preview(id),
  actor_id uuid NOT NULL,
  generation integer NOT NULL,
  operation text NOT NULL CHECK(operation IN ('deploy','stop','rollback','cleanup')),
  policy_version integer NOT NULL,
  input_hash varchar(64) NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','confirmed','unknown','failed','conflict','cleanup')),
  target jsonb NOT NULL,
  before_snapshot jsonb,
  result jsonb,
  error_code varchar(64),
  lease_owner uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX liekan_crawler_deployments_website ON liekan_crawler_deployment(website_id,created_at DESC,id);
CREATE INDEX liekan_crawler_pending_deployments ON liekan_crawler_deployment(state,updated_at) WHERE state IN ('queued','running','unknown','cleanup');
CREATE UNIQUE INDEX liekan_crawler_one_pending_policy ON liekan_crawler_deployment(policy_id) WHERE state IN ('queued','running','unknown','cleanup');

CREATE TABLE liekan_crawler_evidence (
  website_id uuid NOT NULL,
  log_id varchar(64) NOT NULL,
  classification_version varchar(64),
  crawler_id varchar(80),
  security_action varchar(64),
  terminating_rule_id varchar(64),
  matched_rule_ids jsonb,
  cache_status varchar(64),
  duration_ms double precision,
  PRIMARY KEY(website_id,log_id),
  FOREIGN KEY(website_id,log_id) REFERENCES liekan_log(website_id,id) ON DELETE CASCADE
);
CREATE INDEX liekan_crawler_rule_evidence ON liekan_crawler_evidence(website_id,terminating_rule_id) WHERE terminating_rule_id IS NOT NULL;

CREATE TABLE liekan_crawler_catalog_snapshot (
  website_id uuid NOT NULL,
  snapshot_at timestamptz NOT NULL,
  paths jsonb NOT NULL,
  PRIMARY KEY(website_id,snapshot_at)
);

CREATE TABLE liekan_crawler_quality (
  website_id uuid NOT NULL,
  source_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL CHECK(state IN ('complete','partial','unknown')),
  evidence jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(website_id,source_id,starts_at),
  CHECK(ends_at>=starts_at)
);

CREATE TABLE liekan_crawler_finding (
  website_id uuid NOT NULL,
  key varchar(128) NOT NULL,
  bot_id varchar(80) NOT NULL,
  type varchar(80) NOT NULL,
  path_group varchar(512) NOT NULL DEFAULT '/',
  grade text NOT NULL CHECK(grade IN ('high','medium','info')),
  confidence text NOT NULL CHECK(confidence IN ('confirmed','possible','insufficient')),
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','ignored','resolved')),
  facts jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  window_end timestamptz NOT NULL,
  good_windows integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(website_id,key)
);

CREATE TABLE liekan_crawler_analysis_state (
  website_id uuid PRIMARY KEY,
  epoch integer NOT NULL,
  data_revision bigint NOT NULL,
  computed_at timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  quality jsonb NOT NULL,
  error_code varchar(64)
);

CREATE TABLE liekan_crawler_finding_window (
  website_id uuid NOT NULL,
  key varchar(128) NOT NULL,
  window_end timestamptz NOT NULL,
  facts jsonb NOT NULL,
  PRIMARY KEY(website_id,key,window_end)
);

CREATE TABLE liekan_crawler_domain_verification (
  website_id uuid NOT NULL,
  hostname varchar(253) NOT NULL,
  challenge_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(website_id,hostname)
);

CREATE TABLE liekan_crawler_check (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  epoch integer NOT NULL,
  hostname varchar(253) NOT NULL,
  paths jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','failed','cancelled')),
  result jsonb,
  error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  lease_until timestamptz,
  completed_at timestamptz
);
CREATE INDEX liekan_crawler_checks_website ON liekan_crawler_check(website_id,created_at DESC);

CREATE TABLE liekan_crawler_lease (
  name varchar(100) PRIMARY KEY,
  owner uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
