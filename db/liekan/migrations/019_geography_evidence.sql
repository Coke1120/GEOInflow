-- Event evidence contains derived geography only. Visitor IP and UA remain transient.
CREATE TABLE liekan_event_geography (
  event_id uuid PRIMARY KEY REFERENCES website_event(event_id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  country varchar(2), region varchar(20), city varchar(80),
  source text NOT NULL, trust text NOT NULL,
  ip_family text NOT NULL CHECK(ip_family IN ('ipv4','ipv6','missing')),
  precision text NOT NULL CHECK(precision IN ('city','province','country','missing')),
  reason text NOT NULL, rule_version text NOT NULL, data_version text,
  city_id text, accuracy_radius integer CHECK(accuracy_radius>=0), country_basis text NOT NULL,
  processed_at timestamptz NOT NULL, shadow jsonb,
  CHECK(shadow IS NULL OR jsonb_typeof(shadow)='object')
);
CREATE INDEX liekan_event_geography_site ON liekan_event_geography(website_id,precision,processed_at);
CREATE INDEX liekan_geography_visit_anchor ON website_event(website_id,session_id,visit_id,created_at,event_id) WHERE event_type NOT IN(2,5);

CREATE TABLE liekan_log_geography (
  log_id varchar(64) NOT NULL,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  country varchar(2), region varchar(20), city varchar(80),
  declared_location varchar(80), source text NOT NULL, trust text NOT NULL,
  ip_family text NOT NULL, precision text NOT NULL, reason text NOT NULL,
  rule_version text NOT NULL, data_version text, city_id text,
  accuracy_radius integer, country_basis text NOT NULL, processed_at timestamptz NOT NULL, shadow jsonb,
  PRIMARY KEY(website_id,log_id), FOREIGN KEY(website_id,log_id) REFERENCES liekan_log(website_id,id) ON DELETE CASCADE
);
CREATE INDEX liekan_log_geography_site ON liekan_log_geography(website_id,precision,processed_at);

-- Anchor selection is global in time and restricted to the current visit key.
-- One complete tuple is taken from the earliest eligible PV, including when its fields are missing.
CREATE VIEW liekan_geographic_website_event AS
SELECT e.*, CASE WHEN g.event_id IS NOT NULL THEN g.country ELSE s.country END AS liekan_country,
  CASE WHEN g.event_id IS NOT NULL THEN g.region ELSE s.region END AS liekan_region,
  CASE WHEN g.event_id IS NOT NULL THEN g.city ELSE s.city END AS liekan_city
FROM liekan_effective_website_event e
JOIN session s ON s.session_id=e.session_id AND s.website_id=e.website_id
LEFT JOIN LATERAL (
  SELECT a.event_id FROM liekan_effective_website_event a
  WHERE a.website_id=e.website_id AND a.session_id=e.session_id AND a.visit_id=e.visit_id
    AND a.event_type NOT IN(2,5)
  ORDER BY a.created_at,a.event_id LIMIT 1
) anchor ON true
LEFT JOIN liekan_event_geography g ON g.website_id=e.website_id AND g.event_id=anchor.event_id;

CREATE TABLE liekan_geography_ingress (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  bucket timestamptz NOT NULL, reason text NOT NULL CHECK(reason IN ('blocked_ip','invalid_ip')),
  count bigint NOT NULL DEFAULT 0 CHECK(count>=0),
  PRIMARY KEY(website_id,bucket,reason)
);
