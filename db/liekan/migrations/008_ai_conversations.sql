CREATE TABLE liekan_ai_website_state (
  website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
  epoch uuid NOT NULL,
  owner_user_id uuid REFERENCES "user"(user_id) ON DELETE CASCADE,
  team_id uuid REFERENCES team(team_id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL)::integer + (team_id IS NOT NULL)::integer = 1)
);
CREATE TABLE liekan_ai_conversation (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES "user"(user_id) ON DELETE CASCADE,
  team_id uuid REFERENCES team(team_id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  website_epoch uuid NOT NULL,
  title varchar(100) NOT NULL DEFAULT '新的分析',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days',
  CHECK ((owner_user_id IS NOT NULL)::integer + (team_id IS NOT NULL)::integer = 1)
);
CREATE INDEX liekan_ai_conversation_history ON liekan_ai_conversation(creator_id,updated_at DESC,id);
CREATE INDEX liekan_ai_conversation_site ON liekan_ai_conversation(website_id,website_epoch);
CREATE INDEX liekan_ai_conversation_expiry ON liekan_ai_conversation(expires_at);
ALTER TABLE liekan_ai_run ADD COLUMN conversation_id uuid REFERENCES liekan_ai_conversation(id) ON DELETE SET NULL;
CREATE TABLE liekan_ai_context (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES liekan_ai_conversation(id) ON DELETE CASCADE,
  website_epoch uuid NOT NULL,
  facts jsonb NOT NULL,
  checksum varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days'
);
CREATE INDEX liekan_ai_context_expiry ON liekan_ai_context(expires_at);
CREATE TABLE liekan_ai_message (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES liekan_ai_conversation(id) ON DELETE CASCADE,
  run_id uuid UNIQUE REFERENCES liekan_ai_run(id) ON DELETE SET NULL,
  context_id uuid REFERENCES liekan_ai_context(id) ON DELETE SET NULL,
  question text NOT NULL,
  result jsonb,
  origin varchar(20) NOT NULL CHECK (origin IN ('local','provider')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days'
);
CREATE INDEX liekan_ai_message_history ON liekan_ai_message(conversation_id,created_at DESC,id);
CREATE INDEX liekan_ai_message_expiry ON liekan_ai_message(expires_at);
