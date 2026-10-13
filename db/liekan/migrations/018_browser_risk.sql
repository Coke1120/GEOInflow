CREATE TABLE liekan_browser_risk_state (
  website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
  epoch bigint NOT NULL,
  next_window timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  computed_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  error_code text,
  rule_version text NOT NULL
);
CREATE TABLE liekan_browser_risk_window (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  window_end timestamptz NOT NULL,
  epoch bigint NOT NULL,
  rule_version text NOT NULL,
  coverage text NOT NULL CHECK(coverage IN ('observed','partial')),
  events integer NOT NULL,
  visits integer NOT NULL,
  insufficient integer NOT NULL,
  flagged integer NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(website_id,window_end)
);
CREATE INDEX liekan_browser_risk_window_retention ON liekan_browser_risk_window(window_end);
CREATE TABLE liekan_browser_risk (
  website_id uuid NOT NULL,
  window_end timestamptz NOT NULL,
  session_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  reasons text[] NOT NULL,
  features jsonb NOT NULL,
  PRIMARY KEY(website_id,window_end,session_id,visit_id),
  FOREIGN KEY(website_id,window_end) REFERENCES liekan_browser_risk_window(website_id,window_end) ON DELETE CASCADE
);
CREATE INDEX liekan_browser_risk_visit ON liekan_browser_risk(website_id,session_id,visit_id,window_end);
