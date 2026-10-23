CREATE TABLE liekan_cache_meta (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  instance_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO liekan_cache_meta(id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE liekan_geo_weight_snapshot (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  hostname text NOT NULL,
  timezone text NOT NULL,
  as_of date NOT NULL,
  epoch integer NOT NULL,
  algorithm text NOT NULL,
  scope_hash text NOT NULL,
  strong_version text NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  input_boundary jsonb NOT NULL,
  calculated_at timestamptz NOT NULL,
  result jsonb NOT NULL,
  result_bytes integer NOT NULL CHECK (result_bytes > 0 AND result_bytes <= 524288),
  result_digest text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days',
  last_read_at timestamptz NOT NULL DEFAULT now(),
  export_until timestamptz,
  UNIQUE (website_id, hostname, timezone, as_of, epoch, algorithm, scope_hash, strong_version, generation)
);
CREATE INDEX liekan_geo_snapshot_lookup ON liekan_geo_weight_snapshot(website_id,timezone,as_of DESC);
CREATE TABLE liekan_geo_weight_head (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid NOT NULL,
  hostname text NOT NULL,
  timezone text NOT NULL,
  as_of date NOT NULL,
  epoch integer NOT NULL,
  algorithm text NOT NULL,
  scope_hash text NOT NULL,
  strong_version text NOT NULL,
  snapshot_id uuid REFERENCES liekan_geo_weight_snapshot(id) ON DELETE SET NULL,
  generation integer NOT NULL DEFAULT 0,
  expected_generation integer NOT NULL DEFAULT 1,
  task_status text NOT NULL CHECK (task_status IN ('queued','running','ready','failed','capacity_blocked')),
  actor_id uuid NOT NULL,
  ownership text NOT NULL,
  job_id uuid,
  lease_owner uuid,
  lease_epoch integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  error_code text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  manual_at timestamptz,
  UNIQUE(website_id,hostname,timezone,as_of,epoch,algorithm,scope_hash,strong_version)
);
CREATE INDEX liekan_geo_head_schedule ON liekan_geo_weight_head(task_status,next_retry_at,queued_at);
CREATE UNIQUE INDEX liekan_geo_one_running_site ON liekan_geo_weight_head(website_id) WHERE task_status='running';
CREATE TABLE liekan_geo_weight_request (
  website_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  parameter_hash text NOT NULL,
  head_id uuid NOT NULL REFERENCES liekan_geo_weight_head(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(website_id,actor_id,request_id)
);
-- Only corrections/removals of existing proof advance this boundary. Appended logs keep
-- the published day stable. Time ranges keep normal retention outside the snapshot inert.
CREATE TABLE liekan_geo_weight_evidence_revision (
  revision bigserial PRIMARY KEY,
  website_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(website_id,starts_at,ends_at)
);
CREATE INDEX liekan_geo_evidence_revision_window ON liekan_geo_weight_evidence_revision(website_id,starts_at,ends_at);
CREATE FUNCTION liekan_geo_invalidate_proof() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_row jsonb; after_row jsonb; site uuid; starts timestamptz; ends timestamptz;
BEGIN
  before_row := to_jsonb(OLD);
  IF TG_OP='UPDATE' THEN
    after_row := to_jsonb(NEW);
    IF TG_TABLE_NAME='liekan_crawler_quality' AND
      (before_row - 'recorded_at') = (after_row - 'recorded_at') THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME='liekan_crawler_quality' AND before_row->>'state'='complete' AND after_row->>'state'='complete' AND (after_row->>'ends_at')::timestamptz>=(before_row->>'ends_at')::timestamptz
      AND ((before_row->'evidence')-'cursors'-'fromBatchId'-'toBatchId')=((after_row->'evidence')-'cursors'-'fromBatchId'-'toBatchId') THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME='liekan_log_source' AND
      before_row->'domain' IS NOT DISTINCT FROM after_row->'domain' AND
      before_row->'deleted_at' IS NOT DISTINCT FROM after_row->'deleted_at' THEN RETURN NEW; END IF;
  END IF;
  site := (before_row->>'website_id')::uuid;
  IF TG_TABLE_NAME IN ('liekan_log_source','liekan_crawler_rule_version') AND
    NOT EXISTS(SELECT 1 FROM liekan_geo_weight_snapshot s WHERE s.website_id=site AND s.expires_at>now()
      AND CASE TG_TABLE_NAME WHEN 'liekan_log_source' THEN s.input_boundary->'sourceVersions' ? (before_row->>'id')
        ELSE s.input_boundary->'classificationVersions' ? (before_row->>'version') END)
    AND NOT EXISTS(SELECT 1 FROM liekan_geo_weight_head h WHERE h.website_id=site AND h.task_status IN ('queued','running')) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  starts := COALESCE((before_row->>'starts_at')::timestamptz, '-infinity'::timestamptz);
  ends := COALESCE((before_row->>'ends_at')::timestamptz, 'infinity'::timestamptz);
  IF NOT EXISTS(SELECT 1 FROM liekan_geo_weight_snapshot s WHERE s.website_id=site AND s.expires_at>now()
    AND to_timestamp((s.input_boundary->'window'->>'startAt')::double precision/1000)<ends
    AND to_timestamp((s.input_boundary->'window'->>'endAt')::double precision/1000)>starts)
    AND NOT EXISTS(SELECT 1 FROM liekan_geo_weight_head h WHERE h.website_id=site AND h.task_status IN ('queued','running')
      AND ((h.as_of-59)::timestamp AT TIME ZONE h.timezone)<ends
      AND ((h.as_of+1)::timestamp AT TIME ZONE h.timezone)>starts) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END IF;
  INSERT INTO liekan_geo_weight_evidence_revision(website_id,starts_at,ends_at) VALUES(site,starts,ends)
    ON CONFLICT(website_id,starts_at,ends_at) DO UPDATE SET revision=nextval('liekan_geo_weight_evidence_revision_revision_seq'),created_at=now();
  UPDATE liekan_log_state SET policy_revision=policy_revision+1 WHERE website_id=site;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER liekan_geo_quality_correction AFTER UPDATE OR DELETE ON liekan_crawler_quality
  FOR EACH ROW EXECUTE FUNCTION liekan_geo_invalidate_proof();
CREATE TRIGGER liekan_geo_source_correction AFTER UPDATE OR DELETE ON liekan_log_source
  FOR EACH ROW EXECUTE FUNCTION liekan_geo_invalidate_proof();
CREATE TRIGGER liekan_geo_rule_correction AFTER UPDATE OR DELETE ON liekan_crawler_rule_version
  FOR EACH ROW EXECUTE FUNCTION liekan_geo_invalidate_proof();

CREATE FUNCTION liekan_geo_changed_logs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_query text;
BEGIN
  IF TG_TABLE_NAME='liekan_crawler_evidence' THEN
    changed_query := 'SELECT o.website_id,l.created_at FROM old_rows o JOIN liekan_log l ON l.website_id=o.website_id AND l.id=o.log_id';
  ELSE
    changed_query := 'SELECT website_id,created_at FROM old_rows';
  END IF;
  EXECUTE 'WITH affected AS ('||changed_query||'), ranges AS (
    SELECT website_id,date_trunc(''day'',created_at) AS starts_at,date_trunc(''day'',created_at)+interval ''1 day'' AS ends_at
    FROM affected a WHERE EXISTS(SELECT 1 FROM liekan_geo_weight_snapshot s WHERE s.website_id=a.website_id AND s.expires_at>now()
      AND a.created_at>=to_timestamp((s.input_boundary->''window''->>''startAt'')::double precision/1000)
      AND a.created_at<to_timestamp((s.input_boundary->''window''->>''endAt'')::double precision/1000))
    OR EXISTS(SELECT 1 FROM liekan_geo_weight_head h WHERE h.website_id=a.website_id AND h.task_status IN (''queued'',''running'')
      AND a.created_at>=((h.as_of-59)::timestamp AT TIME ZONE h.timezone) AND a.created_at<((h.as_of+1)::timestamp AT TIME ZONE h.timezone))
    GROUP BY website_id,2,3), changed AS (
    INSERT INTO liekan_geo_weight_evidence_revision(website_id,starts_at,ends_at) SELECT * FROM ranges
    ON CONFLICT(website_id,starts_at,ends_at) DO UPDATE SET revision=nextval(''liekan_geo_weight_evidence_revision_revision_seq''),created_at=now() RETURNING website_id)
    UPDATE liekan_log_state SET policy_revision=policy_revision+1 WHERE website_id IN (SELECT website_id FROM changed)';
  RETURN NULL;
END $$;
CREATE TRIGGER liekan_geo_evidence_update AFTER UPDATE ON liekan_crawler_evidence REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_geo_changed_logs();
CREATE TRIGGER liekan_geo_evidence_delete AFTER DELETE ON liekan_crawler_evidence REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_geo_changed_logs();
CREATE TRIGGER liekan_geo_log_update AFTER UPDATE ON liekan_log REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_geo_changed_logs();
CREATE TRIGGER liekan_geo_log_delete AFTER DELETE ON liekan_log REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_geo_changed_logs();

CREATE FUNCTION liekan_geo_protect_archive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text; version_id text;
BEGIN
  field := CASE TG_TABLE_NAME WHEN 'liekan_crawler_registry_version' THEN 'catalogVersions' WHEN 'liekan_crawler_rule_version' THEN 'classificationVersions' ELSE 'verificationVersions' END;
  version_id := to_jsonb(OLD)->>'version';
  IF EXISTS(SELECT 1 FROM liekan_geo_weight_snapshot s
      JOIN website w ON w.website_id=s.website_id AND w.deleted_at IS NULL
      LEFT JOIN liekan_log_state ls ON ls.website_id=s.website_id
      LEFT JOIN liekan_crawler_state cs ON cs.website_id=s.website_id
      WHERE s.epoch=coalesce(ls.epoch,1) AND cs.deleted_at IS NULL
      AND (s.expires_at>now() OR s.export_until>now()) AND s.input_boundary->field ? version_id
      AND (TG_TABLE_NAME<>'liekan_crawler_rule_version' OR s.website_id=(to_jsonb(OLD)->>'website_id')::uuid)) THEN
    RAISE EXCEPTION 'Archive is referenced by a live GEO snapshot';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER liekan_geo_protect_registry BEFORE DELETE ON liekan_crawler_registry_version FOR EACH ROW EXECUTE FUNCTION liekan_geo_protect_archive();
CREATE TRIGGER liekan_geo_protect_rule BEFORE DELETE ON liekan_crawler_rule_version FOR EACH ROW EXECUTE FUNCTION liekan_geo_protect_archive();
CREATE TRIGGER liekan_geo_protect_range BEFORE DELETE ON liekan_crawler_range_snapshot FOR EACH ROW EXECUTE FUNCTION liekan_geo_protect_archive();

CREATE FUNCTION liekan_geo_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD)-'last_read_at'-'export_until') IS DISTINCT FROM (to_jsonb(NEW)-'last_read_at'-'export_until') THEN
    RAISE EXCEPTION 'GEO snapshot results are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER liekan_geo_snapshot_immutable BEFORE UPDATE ON liekan_geo_weight_snapshot
  FOR EACH ROW EXECUTE FUNCTION liekan_geo_snapshot_immutable();
