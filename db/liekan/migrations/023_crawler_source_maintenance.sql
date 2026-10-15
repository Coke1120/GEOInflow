-- Automatic observations never modify catalog identities or website classification rules.
CREATE TABLE liekan_crawler_document_source (
  source_id text PRIMARY KEY,
  source_url text NOT NULL,
  reviewed_at date NOT NULL,
  baseline_hash varchar(64),
  current_hash varchar(64),
  pending_review boolean NOT NULL DEFAULT false,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  error_code text,
  etag text,
  last_modified text,
  lease_token uuid,
  lease_epoch bigint NOT NULL DEFAULT 0,
  lease_until timestamptz,
  CHECK (baseline_hash IS NULL OR baseline_hash ~ '^[a-f0-9]{64}$'),
  CHECK (current_hash IS NULL OR current_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE liekan_crawler_document_lease (
  id text PRIMARY KEY CHECK (id='documents'),
  token uuid,
  epoch bigint NOT NULL DEFAULT 0,
  lease_until timestamptz
);
