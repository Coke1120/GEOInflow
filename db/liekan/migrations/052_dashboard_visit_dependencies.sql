SET LOCAL lock_timeout='2s';
-- Install dependency capture after current source and heatmap writers have committed.
LOCK TABLE website_event,liekan_event_quality,liekan_event_environment,heatmap_event IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION liekan_dashboard_heatmap_dependencies_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; events_sql text;
BEGIN
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
  ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows' END;
 IF TG_TABLE_NAME='website_event' THEN
  events_sql:=format('SELECT DISTINCT website_id,event_id,session_id,visit_id FROM (%s) r',rows_sql);
 ELSE
  events_sql:=format('SELECT DISTINCT e.website_id,e.event_id,e.session_id,e.visit_id FROM (%s) r
   JOIN website_event e ON e.website_id=r.website_id AND e.event_id=r.event_id',rows_sql);
 END IF;
 -- Visit eligibility can change heatmaps recorded before the changed event's own timestamp.
 -- Another unchanged eligible event keeps the visit eligible during ordinary subsequent collection.
 EXECUTE format('WITH changed AS MATERIALIZED (%s),visits AS (
   SELECT DISTINCT website_id,session_id,visit_id FROM changed
  ),affected AS (
   SELECT v.* FROM visits v WHERE NOT EXISTS (
    SELECT 1 FROM liekan_effective_website_event e
    WHERE e.website_id=v.website_id AND e.session_id=v.session_id AND e.visit_id=v.visit_id
     AND NOT EXISTS(SELECT 1 FROM changed c WHERE c.website_id=e.website_id AND c.event_id=e.event_id)
    OFFSET 0
   )
  ) INSERT INTO liekan_dashboard_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT h.website_id,s.epoch,''detail'',date_bin(interval ''30 seconds'',h.created_at,timestamptz ''2000-01-01Z''),
   (get_byte(decode(md5(h.heatmap_event_id::text),''hex''),0) %% 32)::smallint
  FROM affected v JOIN liekan_analysis_site s ON s.website_id=v.website_id AND s.mode=''live''
  JOIN LATERAL (SELECT h.website_id,h.heatmap_event_id,h.created_at FROM heatmap_event h
   WHERE h.website_id=v.website_id AND h.session_id=v.session_id AND h.visit_id=v.visit_id OFFSET 0) h ON true
  ORDER BY h.website_id,s.epoch,4,5
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_dashboard_dirty.revision+1',events_sql);
 RETURN NULL;
END $$;

-- Saved results retain their visible value while the worker verifies the expanded dependencies.
UPDATE liekan_dashboard_snapshot SET fingerprint=NULL,next_refresh_at=clock_timestamp(),
 error_code='dashboard-dependencies-changed' WHERE result IS NOT NULL;
DO $$ DECLARE name text;
BEGIN
 EXECUTE format('ALTER FUNCTION liekan_dashboard_heatmap_dependencies_capture() SET search_path TO %I,pg_temp',current_schema());
 FOREACH name IN ARRAY ARRAY['website_event','liekan_event_quality','liekan_event_environment'] LOOP
  EXECUTE format('CREATE TRIGGER snapshot_visit_heatmap_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_heatmap_dependencies_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_visit_heatmap_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_heatmap_dependencies_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_visit_heatmap_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_heatmap_dependencies_capture()',name);
 END LOOP;
END $$;

CREATE FUNCTION liekan_dashboard_session_dependencies_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; events_sql text; affected_sql text;
BEGIN
 -- New browser events obtain their identity evidence in the same collection transaction.
 IF TG_TABLE_NAME='website_event' AND TG_OP='INSERT' THEN RETURN NULL; END IF;
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
  ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows' END;
 IF TG_TABLE_NAME='website_event' THEN
  events_sql:=format('SELECT DISTINCT website_id,event_id,session_id FROM (%s) r',rows_sql);
 ELSE
  events_sql:=format('SELECT DISTINCT e.website_id,e.event_id,e.session_id FROM (%s) r
   JOIN website_event e ON e.website_id=r.website_id AND e.event_id=r.event_id',rows_sql);
 END IF;
 IF TG_OP='INSERT' THEN
  affected_sql:='SELECT s.* FROM sessions s WHERE EXISTS (
    SELECT 1 FROM changed c JOIN liekan_event_environment env USING(website_id,event_id)
    WHERE c.website_id=s.website_id AND c.session_id=s.session_id
   ) AND (
    SELECT live.distinct_id FROM liekan_effective_session live
    WHERE live.website_id=s.website_id AND live.session_id=s.session_id
   ) IS DISTINCT FROM (
    SELECT env.distinct_id FROM liekan_effective_website_event e
    LEFT JOIN liekan_event_environment env ON env.website_id=e.website_id AND env.event_id=e.event_id
    WHERE e.website_id=s.website_id AND e.session_id=s.session_id
     AND NOT EXISTS(SELECT 1 FROM changed c WHERE c.website_id=e.website_id AND c.event_id=e.event_id)
    ORDER BY e.created_at DESC,e.event_id DESC LIMIT 1
   )';
 ELSE
  -- Maintenance can remove or move the latest identity-bearing event.
  affected_sql:='SELECT * FROM sessions';
 END IF;
 EXECUTE format('WITH changed AS MATERIALIZED (%s),sessions AS (
   SELECT DISTINCT website_id,session_id FROM changed
  ),affected AS (%s)
  INSERT INTO liekan_dashboard_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT e.website_id,s.epoch,''detail'',date_bin(interval ''30 seconds'',e.created_at,timestamptz ''2000-01-01Z''),
   (get_byte(decode(md5(e.event_id::text),''hex''),0) %% 32)::smallint
  FROM affected a JOIN liekan_analysis_site s ON s.website_id=a.website_id AND s.mode=''live''
  JOIN LATERAL (SELECT e.website_id,e.event_id,e.created_at FROM website_event e
   WHERE e.website_id=a.website_id AND e.session_id=a.session_id OFFSET 0) e ON true
  ORDER BY e.website_id,s.epoch,4,5
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_dashboard_dirty.revision+1',events_sql,affected_sql);
 RETURN NULL;
END $$;
DO $$ DECLARE name text;
BEGIN
 EXECUTE format('ALTER FUNCTION liekan_dashboard_session_dependencies_capture() SET search_path TO %I,pg_temp',current_schema());
 FOREACH name IN ARRAY ARRAY['website_event','liekan_event_quality','liekan_event_environment'] LOOP
  EXECUTE format('CREATE TRIGGER snapshot_visit_session_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_session_dependencies_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_visit_session_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_session_dependencies_capture()',name);
  EXECUTE format('CREATE TRIGGER snapshot_visit_session_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_dashboard_session_dependencies_capture()',name);
 END LOOP;
END $$;
