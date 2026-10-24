-- Lifecycle fencing uses key-share locks compatible with ordinary derived-byte accounting.
SET LOCAL lock_timeout TO '2s';
CREATE OR REPLACE FUNCTION liekan_analysis_register(site uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM liekan_analysis_site WHERE website_id=site) THEN RETURN; END IF;
 -- Missing metadata must not wait on a parent held by a lifecycle transaction.
 PERFORM 1 FROM website WHERE website_id=site AND deleted_at IS NULL FOR KEY SHARE NOWAIT;
 IF FOUND THEN INSERT INTO liekan_analysis_site(website_id) VALUES(site) ON CONFLICT DO NOTHING; END IF;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='analysis-epoch-busy';
END $$;
CREATE FUNCTION liekan_analysis_capture_pin(site uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM liekan_analysis_site WHERE website_id=site FOR KEY SHARE NOWAIT;
 IF NOT FOUND THEN
  PERFORM liekan_analysis_register(site);
  PERFORM 1 FROM liekan_analysis_site WHERE website_id=site FOR KEY SHARE NOWAIT;
 END IF;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='analysis-epoch-busy';
END $$;
CREATE OR REPLACE FUNCTION liekan_analysis_invalidate(site uuid,kind text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM liekan_analysis_capture_pin(site);
 INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
 SELECT s.website_id,s.epoch,f.kind,'-infinity'::timestamptz,0
 FROM liekan_analysis_site s CROSS JOIN (VALUES('log'),('visit')) f(kind)
 WHERE s.website_id=site AND s.mode='live' AND (liekan_analysis_invalidate.kind IS NULL OR f.kind=liekan_analysis_invalidate.kind)
 ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE
 SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp();
END $$;
CREATE OR REPLACE FUNCTION liekan_analysis_log_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; site uuid;
BEGIN
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows' ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows' END;
 FOR site IN EXECUTE format('SELECT DISTINCT website_id FROM (%s) r ORDER BY website_id',rows_sql) LOOP
  PERFORM liekan_analysis_capture_pin(site);
 END LOOP;
 EXECUTE format('INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT r.website_id,s.epoch,''log'',date_bin(interval ''5 minutes'',r.created_at,timestamptz ''2000-01-01Z''),
   (get_byte(decode(md5(r.id),''hex''),0) %% 32)::smallint
  FROM (%s) r JOIN liekan_analysis_site s USING(website_id) WHERE s.mode=''live'' AND r.created_at IS NOT NULL
  ORDER BY r.website_id,s.epoch,4,5
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp()',rows_sql);
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION liekan_analysis_identity_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; site uuid;
BEGIN
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows' ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows' END;
 FOR site IN EXECUTE format('SELECT DISTINCT website_id FROM (%s) r ORDER BY website_id',rows_sql) LOOP
  PERFORM liekan_analysis_capture_pin(site);
 END LOOP;
 EXECUTE format('INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT l.website_id,s.epoch,''log'',date_bin(interval ''5 minutes'',l.created_at,timestamptz ''2000-01-01Z''),(get_byte(decode(md5(l.id),''hex''),0) %% 32)::smallint
  FROM (%s) r JOIN liekan_log l ON l.website_id=r.website_id AND l.id=r.log_id JOIN liekan_analysis_site s ON s.website_id=l.website_id
  WHERE s.mode=''live'' ORDER BY 1,2,4,5
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp()',rows_sql);
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION liekan_analysis_visit_evidence_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; changed_sql text; site uuid;
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

CREATE OR REPLACE FUNCTION liekan_analysis_truncate_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE site uuid;
BEGIN
 FOR site IN SELECT website_id FROM liekan_analysis_site ORDER BY website_id LOOP
  PERFORM liekan_analysis_register(site);
  PERFORM liekan_analysis_invalidate(site,NULLIF(TG_ARGV[0],''));
 END LOOP;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION liekan_analysis_website_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO liekan_analysis_site(website_id) VALUES(NEW.website_id) ON CONFLICT DO NOTHING;
 ELSIF (NEW.user_id,NEW.team_id,NEW.reset_at,NEW.deleted_at,NEW.domain) IS DISTINCT FROM (OLD.user_id,OLD.team_id,OLD.reset_at,OLD.deleted_at,OLD.domain) THEN
  PERFORM 1 FROM liekan_analysis_site WHERE website_id=NEW.website_id FOR UPDATE;
  UPDATE liekan_analysis_site SET epoch=epoch+1,revision=revision+1,path_expansion=true,visit_expansion=true,capture_from=clock_timestamp(),updated_at=clock_timestamp() WHERE website_id=NEW.website_id;
  UPDATE liekan_analysis_build SET status='invalidated',lease_token=NULL,lease_until=NULL,error_code='website-changed',revision=revision+1,updated_at=clock_timestamp() WHERE website_id=NEW.website_id AND status IN('queued','running','paused');
  INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision) VALUES('website',NEW.website_id,1)
  ON CONFLICT(resource_type,resource_id) DO UPDATE SET revision=liekan_analytics_revision.revision+1,updated_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION liekan_analysis_website_delete_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM liekan_analysis_site WHERE website_id=OLD.website_id FOR UPDATE;
 RETURN OLD;
END $$;
CREATE TRIGGER liekan_analysis_website_delete_fence BEFORE DELETE ON website FOR EACH ROW EXECUTE FUNCTION liekan_analysis_website_delete_fence();
