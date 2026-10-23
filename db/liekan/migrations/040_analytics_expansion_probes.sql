SET LOCAL lock_timeout='2s';
-- Bounded background measurements govern high-cardinality expansion; unknown measurements leave it unchanged.
CREATE TABLE liekan_analysis_probe (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 epoch bigint NOT NULL, family text NOT NULL CHECK(family IN('path','visit')),
 day timestamptz NOT NULL, versions jsonb NOT NULL, fingerprint text NOT NULL,
 status text NOT NULL CHECK(status IN('ready','unavailable')),
 input_rows bigint NOT NULL DEFAULT 0, derived_rows bigint NOT NULL DEFAULT 0,
 raw_ms double precision, accelerated_ms double precision,
 compared boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,epoch,family,day)
);
CREATE INDEX liekan_analysis_probe_history ON liekan_analysis_probe(website_id,epoch,family,day DESC);
