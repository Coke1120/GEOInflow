-- Content is append-only. Successful observations and active pointers are separate facts.
CREATE TABLE liekan_crawler_range_snapshot (
  source_id text NOT NULL,
  version varchar(64) NOT NULL,
  source_url text NOT NULL,
  parser_version text NOT NULL,
  names jsonb NOT NULL CHECK (jsonb_typeof(names)='array'),
  crawler_ids jsonb NOT NULL CHECK (jsonb_typeof(crawler_ids)='array'),
  prefixes jsonb NOT NULL CHECK (jsonb_typeof(prefixes)='array'),
  address_families jsonb NOT NULL CHECK (jsonb_typeof(address_families)='array'),
  published_at timestamptz,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,version)
);
CREATE INDEX liekan_crawler_range_snapshot_version ON liekan_crawler_range_snapshot(version);

CREATE TABLE liekan_crawler_range_observation (
  source_id text NOT NULL,
  version varchar(64) NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,version,observed_at),
  FOREIGN KEY(source_id,version) REFERENCES liekan_crawler_range_snapshot(source_id,version)
);

CREATE TABLE liekan_crawler_range_source (
  source_id text PRIMARY KEY,
  current_version varchar(64),
  current_observed_at timestamptz,
  candidate_version varchar(64),
  baseline_version varchar(64),
  baseline_observed_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures>=0),
  error_code varchar(80),
  etag text,
  last_modified text,
  lease_epoch bigint NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  FOREIGN KEY(source_id,current_version) REFERENCES liekan_crawler_range_snapshot(source_id,version),
  FOREIGN KEY(source_id,candidate_version) REFERENCES liekan_crawler_range_snapshot(source_id,version)
);

-- Preserve only the legacy contents that still exist. Missing historical versions remain missing.
INSERT INTO liekan_crawler_range_snapshot(source_id,version,source_url,parser_version,names,crawler_ids,prefixes,address_families,observed_at)
SELECT 'legacy:'||bot,version,source_url,'legacy-unbound-v0',jsonb_build_array(bot),'[]'::jsonb,prefixes,
  (SELECT coalesce(jsonb_agg(DISTINCT CASE WHEN value LIKE '%:%' THEN 'ipv6' ELSE 'ipv4' END),'[]'::jsonb) FROM jsonb_array_elements_text(prefixes)),retrieved_at
FROM liekan_bot_snapshot;
