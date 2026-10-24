SET LOCAL lock_timeout='2s';
CREATE TABLE liekan_dashboard_snapshot (
 website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
 query_key text NOT NULL, actor_id uuid NOT NULL, target text NOT NULL,
 parameters jsonb NOT NULL, locale text NOT NULL CHECK(locale IN('zh-CN','en-US')),
 strong_version text NOT NULL, epoch bigint NOT NULL, calendar_day text NOT NULL,
 result jsonb, result_bytes integer NOT NULL DEFAULT 0 CHECK(result_bytes BETWEEN 0 AND 2097152),
 generated_at timestamptz, data_through timestamptz, fingerprint text,
 dependency_end timestamptz NOT NULL,
 next_refresh_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz,
 job_id uuid REFERENCES liekan_analysis_query(id) ON DELETE SET NULL,
 pending_fingerprint text, pending_through timestamptz,
 last_read_at timestamptz NOT NULL DEFAULT now(), error_code text,
 PRIMARY KEY(website_id,query_key)
);
CREATE INDEX liekan_dashboard_due ON liekan_dashboard_snapshot(next_refresh_at);
CREATE INDEX liekan_dashboard_job ON liekan_dashboard_snapshot(job_id) WHERE job_id IS NOT NULL;
ALTER TABLE liekan_analysis_site ADD COLUMN archive_epoch bigint;
ALTER TABLE liekan_analysis_site ADD COLUMN archive_next timestamptz;
ALTER TABLE liekan_analysis_site ADD COLUMN archive_until timestamptz;
ALTER TABLE liekan_analysis_site ADD COLUMN archive_complete boolean NOT NULL DEFAULT false;
ALTER TABLE liekan_analysis_site ADD COLUMN archive_build_id uuid;
ALTER TABLE liekan_analysis_site ADD COLUMN archive_checked_at timestamptz;
ALTER TABLE liekan_analysis_site ADD COLUMN dashboard_seed_checked_at timestamptz;
ALTER TABLE liekan_analysis_build ADD COLUMN automatic_history boolean NOT NULL DEFAULT false;

-- Fine markers keep post-cutoff events independent of an already closed five-minute batch.
CREATE TABLE liekan_dashboard_dirty (
 website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
 epoch bigint NOT NULL, family text NOT NULL CHECK(family IN('visit','detail')),
 bucket timestamptz NOT NULL, shard smallint NOT NULL CHECK(shard BETWEEN 0 AND 31),
 revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(website_id,epoch,family,bucket,shard)
);
CREATE FUNCTION liekan_dashboard_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; facts_sql text; site uuid; kind text;
BEGIN
 kind:=CASE WHEN TG_TABLE_NAME IN('website_event','liekan_event_quality','liekan_event_environment') THEN 'visit' ELSE 'detail' END;
 IF TG_OP='TRUNCATE' THEN
  INSERT INTO liekan_dashboard_dirty(website_id,epoch,family,bucket,shard)
   SELECT website_id,epoch,kind,'-infinity',0 FROM liekan_analysis_site WHERE mode='live'
   ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_dashboard_dirty.revision+1;
  RETURN NULL;
 END IF;
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
  ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows' END;
 FOR site IN EXECUTE format('SELECT DISTINCT website_id FROM (%s) r ORDER BY website_id',rows_sql) LOOP
  PERFORM liekan_analysis_register(site);
 END LOOP;
 IF TG_TABLE_NAME IN('liekan_event_quality','liekan_event_environment') THEN
  facts_sql:=format('SELECT e.website_id,e.created_at,e.event_id::text AS identity FROM (%s) r JOIN website_event e ON e.website_id=r.website_id AND e.event_id=r.event_id',rows_sql);
 ELSE
  facts_sql:=format('SELECT r.website_id,r.created_at,to_jsonb(r)->>%L AS identity FROM (%s) r',
   CASE TG_TABLE_NAME WHEN 'website_event' THEN 'event_id' WHEN 'event_data' THEN 'event_data_id'
    WHEN 'session_data' THEN 'session_data_id' WHEN 'revenue' THEN 'revenue_id' ELSE 'heatmap_event_id' END,rows_sql);
 END IF;
 EXECUTE format('INSERT INTO liekan_dashboard_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT r.website_id,s.epoch,$1,date_bin(interval ''5 minutes'',r.created_at,timestamptz ''2000-01-01Z''),
   (get_byte(decode(md5(coalesce(r.identity,'''')),''hex''),0) %% 32)::smallint
  FROM (%s) r JOIN liekan_analysis_site s ON s.website_id=r.website_id AND s.mode=''live'' WHERE r.created_at IS NOT NULL
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_dashboard_dirty.revision+1',facts_sql) USING kind;
 RETURN NULL;
END $$;
DO $$ DECLARE name text;
BEGIN
 EXECUTE format('ALTER FUNCTION liekan_dashboard_capture() SET search_path TO %I,pg_temp',current_schema());
 FOREACH name IN ARRAY ARRAY['website_event','liekan_event_quality','liekan_event_environment','event_data','session_data','revenue','heatmap_event'] LOOP
  EXECUTE format('CREATE TRIGGER snapshot_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_capture()',name);
 END LOOP;
END $$;
CREATE FUNCTION liekan_dashboard_fingerprint(site uuid,epoch_id bigint,ends timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT liekan_analysis_fingerprint(site,epoch_id,'log','-infinity',ends)
  ||liekan_analysis_fingerprint(site,epoch_id,'visit','-infinity',date_bin(interval '1 hour',ends,timestamptz '2000-01-01Z'))
  ||encode(sha256(convert_to(coalesce(string_agg(d.family||':'||extract(epoch FROM d.bucket)::text||':'||d.shard::text||':'||d.revision::text,',' ORDER BY d.family,d.bucket,d.shard),''),'UTF8')),'hex')
 FROM liekan_dashboard_dirty d WHERE d.website_id=site AND d.epoch=epoch_id AND d.bucket<ends
  AND (d.family='detail' OR d.bucket>=date_bin(interval '1 hour',ends,timestamptz '2000-01-01Z') OR d.bucket='-infinity')
$$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION liekan_dashboard_fingerprint(uuid,bigint,timestamptz) SET search_path TO %I,pg_temp',current_schema()); END $$;
