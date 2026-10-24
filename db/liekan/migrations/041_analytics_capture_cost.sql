-- Keep every raw/evidence statement atomic while marking each affected leaf once.
SET LOCAL lock_timeout TO '2s';
CREATE OR REPLACE FUNCTION liekan_analysis_visit_evidence_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; changed_sql text;
BEGIN
 rows_sql:=CASE TG_OP
  WHEN 'INSERT' THEN 'SELECT * FROM new_rows'
  WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
  ELSE '(SELECT * FROM old_rows EXCEPT SELECT * FROM new_rows) UNION ALL (SELECT * FROM new_rows EXCEPT SELECT * FROM old_rows)'
 END;
 -- Trusted fallback registration is proportional to the transition rows and skips known sites.
 EXECUTE format('INSERT INTO liekan_analysis_site(website_id)
  SELECT DISTINCT r.website_id FROM (%s) r JOIN website w ON w.website_id=r.website_id
  WHERE w.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM liekan_analysis_site s WHERE s.website_id=r.website_id)
  ON CONFLICT DO NOTHING',rows_sql);
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
