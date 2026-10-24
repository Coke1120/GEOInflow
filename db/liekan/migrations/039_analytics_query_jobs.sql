SET LOCAL lock_timeout='2s';
CREATE TABLE liekan_analysis_query (
 id uuid PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY,
 website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, target text NOT NULL, parameters jsonb NOT NULL,
 query_key text NOT NULL, strong_version text NOT NULL, catalog_version uuid,
 epoch bigint NOT NULL, forced boolean NOT NULL DEFAULT false,
 status text NOT NULL CHECK(status IN('queued','running','ready','failed','invalidated','expired')),
 locale text NOT NULL CHECK(locale IN('zh-CN','en-US')),
 result jsonb, started_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(), generated_at timestamptz, expires_at timestamptz, completed_at timestamptz,
 retention_until timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 result_bytes integer NOT NULL DEFAULT 0 CHECK(result_bytes BETWEEN 0 AND 2097152),
 lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 error_code text, queued_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX liekan_analysis_query_lookup ON liekan_analysis_query(website_id,query_key,sequence DESC);
CREATE INDEX liekan_analysis_query_pending ON liekan_analysis_query(status,queued_at);
CREATE TABLE liekan_analysis_query_consumer (
 job_id uuid NOT NULL REFERENCES liekan_analysis_query(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL, joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,actor_id)
);
CREATE TABLE liekan_analysis_background_lease (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), token uuid, epoch bigint NOT NULL DEFAULT 0,
 lease_until timestamptz, last_incremental_at timestamptz, incremental_waiting_at timestamptz, history_waiting_at timestamptz, interactive_turns integer NOT NULL DEFAULT 0
);
INSERT INTO liekan_analysis_background_lease(id) VALUES(true);
