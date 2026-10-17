SET LOCAL lock_timeout TO '5s';
CREATE TABLE liekan_event_observation (
  event_id uuid PRIMARY KEY REFERENCES website_event(event_id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  epoch integer NOT NULL,
  version text NOT NULL,
  event_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  features jsonb NOT NULL
);
CREATE INDEX liekan_observation_site_received ON liekan_event_observation(website_id, received_at);
CREATE INDEX liekan_observation_received ON liekan_event_observation(received_at);
CREATE TABLE liekan_observation_state (
  website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
  epoch integer NOT NULL,
  first_received_at timestamptz NOT NULL,
  last_received_at timestamptz NOT NULL,
  last_version text NOT NULL,
  pruned_before timestamptz
);
ALTER TABLE liekan_crawler_evidence ADD COLUMN edge_observation jsonb;
