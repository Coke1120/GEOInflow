CREATE TABLE liekan_ai_connection (
  id uuid PRIMARY KEY,
  owner_user_id uuid REFERENCES "user"(user_id) ON DELETE CASCADE,
  team_id uuid REFERENCES team(team_id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  provider varchar(30) NOT NULL,
  protocol varchar(30) NOT NULL CHECK (protocol IN ('openai-chat','anthropic-messages')),
  base_url varchar(500) NOT NULL,
  model varchar(120) NOT NULL,
  secret_envelope jsonb,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1,
  config_version integer NOT NULL DEFAULT 1,
  test_state varchar(20) NOT NULL DEFAULT 'untested',
  tested_at timestamptz,
  verified_config_version integer,
  test_sequence integer NOT NULL DEFAULT 0,
  capabilities jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL)::integer + (team_id IS NOT NULL)::integer = 1),
  CHECK (NOT is_default OR (enabled AND secret_envelope IS NOT NULL AND verified_config_version=config_version AND test_state='connected'))
);
CREATE UNIQUE INDEX liekan_ai_default_user ON liekan_ai_connection(owner_user_id) WHERE is_default;
CREATE UNIQUE INDEX liekan_ai_default_team ON liekan_ai_connection(team_id) WHERE is_default;
CREATE INDEX liekan_ai_connections_user ON liekan_ai_connection(owner_user_id,created_at,id);
CREATE INDEX liekan_ai_connections_team ON liekan_ai_connection(team_id,created_at,id);
CREATE TABLE liekan_ai_run (
  id uuid PRIMARY KEY,
  creator_id uuid REFERENCES "user"(user_id) ON DELETE SET NULL,
  identity_id uuid NOT NULL,
  owner_user_id uuid REFERENCES "user"(user_id) ON DELETE CASCADE,
  team_id uuid REFERENCES team(team_id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  operation varchar(20) NOT NULL CHECK (operation IN ('test','analysis')),
  connection_id uuid REFERENCES liekan_ai_connection(id) ON DELETE SET NULL,
  connection_snapshot jsonb NOT NULL,
  config_version integer NOT NULL,
  test_sequence integer,
  website_id uuid REFERENCES website(website_id) ON DELETE SET NULL,
  website_epoch uuid,
  state varchar(30) NOT NULL DEFAULT 'accepted' CHECK (state IN ('accepted','preparing','calling','validating','cancel_requested','completed','failed','cancelled','interrupted','invalidated')),
  stage varchar(50) NOT NULL DEFAULT 'accepted',
  lease_token uuid,
  lease_until timestamptz,
  call_attempted boolean NOT NULL DEFAULT false,
  daily_reserved boolean NOT NULL DEFAULT true,
  error_code varchar(50),
  error_message varchar(200),
  usage jsonb,
  test_result jsonb,
  ttft_ms integer,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '180 days',
  result_expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
  CHECK ((owner_user_id IS NOT NULL)::integer + (team_id IS NOT NULL)::integer = 1),
  UNIQUE(identity_id,client_request_id)
);
CREATE INDEX liekan_ai_run_user_history ON liekan_ai_run(identity_id,created_at DESC,id);
CREATE INDEX liekan_ai_run_user_frequency ON liekan_ai_run(identity_id,created_at);
CREATE INDEX liekan_ai_run_user_quota ON liekan_ai_run(owner_user_id,created_at) WHERE daily_reserved;
CREATE INDEX liekan_ai_run_team_quota ON liekan_ai_run(team_id,created_at) WHERE daily_reserved;
CREATE INDEX liekan_ai_run_active_lease ON liekan_ai_run(lease_until) WHERE state IN ('accepted','preparing','calling','validating','cancel_requested');
CREATE INDEX liekan_ai_run_connection ON liekan_ai_run(connection_id,state);
CREATE INDEX liekan_ai_run_website ON liekan_ai_run(website_id,state);
CREATE INDEX liekan_ai_run_expiry ON liekan_ai_run(expires_at);
CREATE TABLE liekan_ai_maintenance (
  id integer PRIMARY KEY CHECK (id=1),
  last_cleanup_at timestamptz,
  last_error_code varchar(50),
  backlog bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO liekan_ai_maintenance(id) VALUES (1);
