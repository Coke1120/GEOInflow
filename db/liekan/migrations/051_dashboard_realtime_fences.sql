SET LOCAL lock_timeout='2s';
-- Drain source writers before replacing their capture function, including already executing triggers.
LOCK TABLE website_event,liekan_event_quality,liekan_event_environment,event_data,session_data,revenue,heatmap_event,liekan_log,liekan_crawler_evidence IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE liekan_dashboard_dirty DROP CONSTRAINT liekan_dashboard_dirty_family_check;
ALTER TABLE liekan_dashboard_dirty ADD CONSTRAINT liekan_dashboard_dirty_family_check CHECK(family IN('visit','detail','log'));

CREATE OR REPLACE FUNCTION liekan_dashboard_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; facts_sql text; site uuid; kind text;
BEGIN
 kind:=CASE WHEN TG_TABLE_NAME IN('liekan_log','liekan_crawler_evidence') THEN 'log' WHEN TG_TABLE_NAME IN('website_event','liekan_event_quality','liekan_event_environment') THEN 'visit' ELSE 'detail' END;
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
 IF TG_TABLE_NAME='liekan_crawler_evidence' THEN
  facts_sql:=format('SELECT l.website_id,l.created_at,l.id AS identity FROM (%s) r JOIN liekan_log l ON l.website_id=r.website_id AND l.id=r.log_id',rows_sql);
 ELSIF TG_TABLE_NAME IN('liekan_event_quality','liekan_event_environment') THEN
  facts_sql:=format('SELECT e.website_id,e.created_at,e.event_id::text AS identity FROM (%s) r JOIN website_event e ON e.website_id=r.website_id AND e.event_id=r.event_id',rows_sql);
 ELSE
  facts_sql:=format('SELECT r.website_id,r.created_at,to_jsonb(r)->>%L AS identity FROM (%s) r',
   CASE TG_TABLE_NAME WHEN 'website_event' THEN 'event_id' WHEN 'event_data' THEN 'event_data_id'
    WHEN 'session_data' THEN 'session_data_id' WHEN 'revenue' THEN 'revenue_id' WHEN 'liekan_log' THEN 'id' ELSE 'heatmap_event_id' END,rows_sql);
 END IF;
 EXECUTE format('INSERT INTO liekan_dashboard_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT r.website_id,s.epoch,$1,date_bin(interval ''30 seconds'',r.created_at,timestamptz ''2000-01-01Z''),
   (get_byte(decode(md5(coalesce(r.identity,'''')),''hex''),0) %% 32)::smallint
  FROM (%s) r JOIN liekan_analysis_site s ON s.website_id=r.website_id AND s.mode=''live'' WHERE r.created_at IS NOT NULL
  ORDER BY r.website_id,s.epoch,4,5
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_dashboard_dirty.revision+1',facts_sql) USING kind;
 RETURN NULL;
END $$;
DO $$ DECLARE name text;
BEGIN
 EXECUTE format('ALTER FUNCTION liekan_dashboard_capture() SET search_path TO %I,pg_temp',current_schema());
 FOREACH name IN ARRAY ARRAY['liekan_log','liekan_crawler_evidence'] LOOP
  EXECUTE format('CREATE TRIGGER snapshot_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_capture()',name);
 END LOOP;
END $$;
-- Coarse rollups retain their original capture and discovery units; fine markers fence each tail.
CREATE OR REPLACE FUNCTION liekan_dashboard_fingerprint(site uuid,epoch_id bigint,ends timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT liekan_analysis_fingerprint(site,epoch_id,'log','-infinity',date_bin(interval '5 minutes',ends,timestamptz '2000-01-01Z'))
  ||liekan_analysis_fingerprint(site,epoch_id,'visit','-infinity',date_bin(interval '1 hour',ends,timestamptz '2000-01-01Z'))
  ||encode(sha256(convert_to(coalesce(string_agg(d.family||':'||extract(epoch FROM d.bucket)::text||':'||d.shard::text||':'||d.revision::text,',' ORDER BY d.family,d.bucket,d.shard),''),'UTF8')),'hex')
 FROM liekan_dashboard_dirty d WHERE d.website_id=site AND d.epoch=epoch_id AND d.bucket<ends
  AND (d.family='detail' OR d.bucket='-infinity'
   OR (d.family='visit' AND d.bucket>=date_bin(interval '1 hour',ends,timestamptz '2000-01-01Z'))
   OR (d.family='log' AND d.bucket>=date_bin(interval '5 minutes',ends,timestamptz '2000-01-01Z')))
$$;
DO $$ BEGIN EXECUTE format('ALTER FUNCTION liekan_dashboard_fingerprint(uuid,bigint,timestamptz) SET search_path TO %I,pg_temp',current_schema()); END $$;
