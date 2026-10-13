CREATE TABLE liekan_collection_diagnostic (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  bucket timestamptz NOT NULL,
  shard smallint NOT NULL CHECK (shard >= 0 AND shard < 32),
  written bigint NOT NULL DEFAULT 0,
  with_uuid bigint NOT NULL DEFAULT 0,
  duplicate bigint NOT NULL DEFAULT 0,
  first_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(website_id,bucket,shard)
);
CREATE INDEX liekan_collection_diagnostic_retention ON liekan_collection_diagnostic(bucket);
CREATE TABLE liekan_collection_diagnostic_state (
  website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE liekan_collection_policy_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  before_policy jsonb NOT NULL,
  after_policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX liekan_collection_policy_history_site ON liekan_collection_policy_history(website_id,id DESC);
CREATE INDEX liekan_quality_observed ON liekan_event_quality(website_id,created_at,event_id);
