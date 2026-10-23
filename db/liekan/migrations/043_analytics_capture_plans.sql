-- Cache the common bounded INSERT plan while preserving the unbounded transition fallback.
SET LOCAL lock_timeout TO '2s';
ALTER TABLE liekan_analysis_site ADD COLUMN incremental_served_at timestamptz, ADD COLUMN history_served_at timestamptz;
CREATE FUNCTION liekan_analysis_visit_insert_markers(site_ids uuid[],event_ids uuid[],visit_ids uuid[],event_times timestamptz[])
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 WITH changed AS MATERIALIZED (
  SELECT r.* FROM unnest(site_ids,event_ids,visit_ids,event_times) AS r(website_id,event_id,visit_id,created_at) JOIN liekan_analysis_site s USING(website_id) WHERE s.mode='live'
 ), sites AS MATERIALIZED (
  SELECT s.website_id,s.epoch FROM liekan_analysis_site s JOIN (SELECT DISTINCT website_id FROM changed) r USING(website_id)
 ), targets AS (SELECT DISTINCT website_id,visit_id FROM changed), neighbors AS MATERIALIZED (
  SELECT e.website_id,e.created_at,e.event_id FROM targets t CROSS JOIN LATERAL (
   SELECT e.website_id,e.created_at,e.event_id FROM website_event e
   WHERE e.website_id=t.website_id AND e.visit_id=t.visit_id LIMIT 2001
  ) e LIMIT 2001
 ), bound AS (SELECT count(*) AS n FROM neighbors), markers AS (
  SELECT c.website_id,s.epoch,date_bin(interval '1 hour',c.created_at,timestamptz '2000-01-01Z') AS bucket,
   (get_byte(decode(md5(c.event_id::text),'hex'),0) % 32)::smallint AS shard
  FROM changed c JOIN sites s USING(website_id) WHERE c.created_at IS NOT NULL
  UNION ALL
  SELECT n.website_id,s.epoch,date_bin(interval '1 hour',n.created_at,timestamptz '2000-01-01Z'),
   (get_byte(decode(md5(n.event_id::text),'hex'),0) % 32)::smallint
  FROM neighbors n JOIN sites s USING(website_id) WHERE (SELECT n FROM bound)<2001 AND n.created_at IS NOT NULL
  UNION ALL
  SELECT website_id,epoch,'-infinity'::timestamptz,0::smallint FROM sites WHERE (SELECT n FROM bound)>=2001
 ) INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT website_id,epoch,'visit',bucket,shard FROM markers ORDER BY website_id,epoch,bucket,shard
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE
  SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp();
END $$;

CREATE OR REPLACE FUNCTION liekan_analysis_visit_evidence_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; changed_sql text; site uuid;
 site_ids uuid[]; event_ids uuid[]; visit_ids uuid[]; event_times timestamptz[];
BEGIN
 rows_sql:=CASE TG_OP
  WHEN 'INSERT' THEN 'SELECT * FROM new_rows'
  WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
  ELSE '(SELECT * FROM old_rows EXCEPT SELECT * FROM new_rows) UNION ALL (SELECT * FROM new_rows EXCEPT SELECT * FROM old_rows)'
 END;
 -- Trusted fallback registration is proportional to the transition rows and skips known sites.
 FOR site IN EXECUTE format('SELECT DISTINCT website_id FROM (%s) r ORDER BY website_id',rows_sql) LOOP
  PERFORM liekan_analysis_capture_pin(site);
 END LOOP;
 -- Arrays hold at most 2001 facts; large statements retain the full transition-table path.
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='website_event' THEN
   SELECT array_agg(r.website_id),array_agg(r.event_id),array_agg(r.visit_id),array_agg(r.created_at)
   INTO site_ids,event_ids,visit_ids,event_times
   FROM (SELECT website_id,event_id,visit_id,created_at FROM new_rows LIMIT 2001) r;
  ELSE
   SELECT array_agg(r.website_id),array_agg(r.event_id),array_agg(r.visit_id),array_agg(r.created_at)
   INTO site_ids,event_ids,visit_ids,event_times
   FROM (SELECT e.website_id,e.event_id,e.visit_id,e.created_at FROM new_rows n
    JOIN website_event e ON e.website_id=n.website_id AND e.event_id=n.event_id LIMIT 2001) r;
  END IF;
  IF coalesce(cardinality(site_ids),0)<=2000 THEN
   PERFORM liekan_analysis_visit_insert_markers(site_ids,event_ids,visit_ids,event_times);
   RETURN NULL;
  END IF;
 END IF;
 IF TG_TABLE_NAME='website_event' THEN
  changed_sql:=format('SELECT r.website_id,r.event_id,r.visit_id,r.created_at FROM (%s) r',rows_sql);
 ELSE
  changed_sql:=format('SELECT e.website_id,e.event_id,e.visit_id,e.created_at FROM (%s) r
   JOIN website_event e ON e.website_id=r.website_id AND e.event_id=r.event_id',rows_sql);
 END IF;
 -- Only live sites drive the bounded visit probes. Old transition rows preserve moved/deleted leaves.
 -- Every statement advances the revision; no transaction identity or timestamp deduplication is used.
 EXECUTE format('WITH changed AS MATERIALIZED (
  SELECT r.* FROM (%s) r JOIN liekan_analysis_site s USING(website_id) WHERE s.mode=''live''
 ), sites AS MATERIALIZED (
  SELECT s.website_id,s.epoch FROM liekan_analysis_site s JOIN (SELECT DISTINCT website_id FROM changed) r USING(website_id)
 ), targets AS (SELECT DISTINCT website_id,visit_id FROM changed), neighbors AS MATERIALIZED (
  SELECT e.website_id,e.created_at,e.event_id FROM targets t CROSS JOIN LATERAL (
   SELECT e.website_id,e.created_at,e.event_id FROM website_event e
   WHERE e.website_id=t.website_id AND e.visit_id=t.visit_id LIMIT 2001
  ) e LIMIT 2001
 ), bound AS (SELECT count(*) AS n FROM neighbors), markers AS (
  SELECT c.website_id,s.epoch,date_bin(interval ''1 hour'',c.created_at,timestamptz ''2000-01-01Z'') AS bucket,
   (get_byte(decode(md5(c.event_id::text),''hex''),0) %% 32)::smallint AS shard
  FROM changed c JOIN sites s USING(website_id) WHERE c.created_at IS NOT NULL
  UNION ALL
  SELECT n.website_id,s.epoch,date_bin(interval ''1 hour'',n.created_at,timestamptz ''2000-01-01Z''),
   (get_byte(decode(md5(n.event_id::text),''hex''),0) %% 32)::smallint
  FROM neighbors n JOIN sites s USING(website_id) WHERE (SELECT n FROM bound)<2001 AND n.created_at IS NOT NULL
  UNION ALL
  SELECT website_id,epoch,''-infinity''::timestamptz,0::smallint FROM sites WHERE (SELECT n FROM bound)>=2001
 ) INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT website_id,epoch,''visit'',bucket,shard FROM markers ORDER BY website_id,epoch,bucket,shard
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE
  SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp()',changed_sql);
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION liekan_analysis_secondary_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; projection text; site uuid;
BEGIN
 IF TG_OP='INSERT' AND TG_TABLE_NAME='session' THEN
  -- Even a new session without visible events holds the disabled/live epoch boundary.
  FOR site IN SELECT DISTINCT website_id FROM new_rows ORDER BY website_id LOOP
   PERFORM liekan_analysis_capture_pin(site);
  END LOOP;
  FOR site IN SELECT DISTINCT r.website_id FROM new_rows r
   WHERE EXISTS(SELECT 1 FROM website_event e WHERE e.website_id=r.website_id AND e.session_id=r.session_id LIMIT 1) ORDER BY r.website_id LOOP
   PERFORM liekan_analysis_register(site);
   PERFORM liekan_analysis_invalidate(site,'visit');
  END LOOP;
  RETURN NULL;
 END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('liekan_log_state','liekan_log_source','liekan_history_repair_run') THEN
  projection:=CASE TG_TABLE_NAME
   WHEN 'liekan_log_state' THEN 'jsonb_build_array(r.website_id,r.epoch,r.policy_revision,r.reset_at)'
   WHEN 'liekan_log_source' THEN 'jsonb_build_array(r.id,r.website_id,r.kind,r.domain,r.created_by,r.owner_id,r.team_id,r.state,r.requested_policy_revision,to_jsonb(r)->''deleted_at'')'
   ELSE 'jsonb_build_array(r.id,r.website_id,r.active_generation,r.active_revision)' END;
  rows_sql:=format('SELECT website_id FROM (
   (SELECT r.website_id,%1$s AS semantic FROM old_rows r EXCEPT SELECT r.website_id,%1$s AS semantic FROM new_rows r)
   UNION ALL
   (SELECT r.website_id,%1$s AS semantic FROM new_rows r EXCEPT SELECT r.website_id,%1$s AS semantic FROM old_rows r)) changed',projection);
 ELSIF TG_OP='UPDATE' THEN
  rows_sql:='(SELECT * FROM old_rows EXCEPT SELECT * FROM new_rows) UNION ALL (SELECT * FROM new_rows EXCEPT SELECT * FROM old_rows)';
 ELSE
  rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' ELSE 'SELECT * FROM old_rows' END;
 END IF;
 -- Staged repair rows become visible only when the run publishes its active generation.
 IF TG_TABLE_NAME='liekan_history_repair_result' THEN
  rows_sql:=format('SELECT r.* FROM (%s) r JOIN liekan_history_repair_run active ON active.id=r.run_id AND active.website_id=r.website_id AND active.active_generation=r.generation',rows_sql);
 END IF;
 FOR site IN EXECUTE format('SELECT DISTINCT website_id FROM (%s) r ORDER BY website_id',rows_sql) LOOP
  PERFORM liekan_analysis_register(site);
  PERFORM liekan_analysis_invalidate(site,NULLIF(TG_ARGV[0],''));
 END LOOP;
 RETURN NULL;
END $$;
-- Prisma qualifies ORM tables but keeps a connection's default search_path. Bind only
-- trigger execution boundaries; nested helpers inherit the schema and readers keep
-- their existing transaction-local schema. SQL read functions retain inlining.
DO $$
DECLARE fn record;
BEGIN
 FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname=current_schema() AND starts_with(p.proname,'liekan_analysis_') AND l.lanname='plpgsql' AND p.prorettype='trigger'::regtype
 LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path TO %I,pg_temp',fn.signature,current_schema());
 END LOOP;
END $$;
