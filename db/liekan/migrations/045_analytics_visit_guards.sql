-- Single-event collection serializes each visit before the marker snapshot.
-- Multi-event maintenance first locks its website FOR UPDATE.
SET LOCAL lock_timeout TO '2s';
CREATE TABLE liekan_analysis_visit_guard (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 slot smallint NOT NULL CHECK(slot BETWEEN 0 AND 31),
 PRIMARY KEY(website_id,slot)
);
CREATE FUNCTION liekan_analysis_visit_guard_init() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO liekan_analysis_visit_guard(website_id,slot)
 SELECT NEW.website_id,n::smallint FROM generate_series(0,31) n;
 RETURN NULL;
END $$;
CREATE TRIGGER liekan_analysis_visit_guard_init AFTER INSERT ON liekan_analysis_site
 FOR EACH ROW EXECUTE FUNCTION liekan_analysis_visit_guard_init();
INSERT INTO liekan_analysis_visit_guard(website_id,slot)
 SELECT s.website_id,n::smallint FROM liekan_analysis_site s CROSS JOIN generate_series(0,31) n;

-- Row locks do not allocate an advisory lock entry for every visit/site in a large statement.
-- NULL slot locks all 32 rows in order. Site registration atomically initializes these rows;
-- ordinary capture rejects missing guards instead of lazily repairing them while holding raw locks.
CREATE FUNCTION liekan_analysis_visit_guard_lock(site uuid,slot_id smallint DEFAULT NULL,wait_lock boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE locked_rows integer;
BEGIN
 -- Missing website metadata (including link/pixel IDs) remains a legal no-op.
 -- Disabled sites still pin their epoch before the live-only guard check.
 PERFORM liekan_analysis_capture_pin(site);
 IF NOT EXISTS(SELECT 1 FROM liekan_analysis_site WHERE website_id=site AND mode='live') THEN RETURN; END IF;
 IF wait_lock THEN
  PERFORM g.slot FROM liekan_analysis_visit_guard g WHERE g.website_id=site AND (slot_id IS NULL OR g.slot=slot_id)
   ORDER BY g.slot FOR NO KEY UPDATE;
 ELSE
  PERFORM g.slot FROM liekan_analysis_visit_guard g WHERE g.website_id=site AND (slot_id IS NULL OR g.slot=slot_id)
   ORDER BY g.slot FOR NO KEY UPDATE NOWAIT;
 END IF;
 GET DIAGNOSTICS locked_rows=ROW_COUNT;
 IF locked_rows<>(CASE WHEN slot_id IS NULL THEN 32 ELSE 1 END) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='analysis-visit-guard-missing';
 END IF;
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='analysis-visit-busy';
END $$;

CREATE OR REPLACE FUNCTION liekan_analysis_invalidate(site uuid,kind text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM liekan_analysis_capture_pin(site);
 IF kind IS NULL OR kind='visit' THEN PERFORM liekan_analysis_visit_guard_lock(site,NULL,false); END IF;
 -- Guard acquisition precedes both families, including their shared meter row.
 INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
 SELECT s.website_id,s.epoch,f.kind,'-infinity'::timestamptz,0
 FROM liekan_analysis_site s CROSS JOIN (VALUES('log'),('visit')) f(kind)
 WHERE s.website_id=site AND s.mode='live' AND (liekan_analysis_invalidate.kind IS NULL OR f.kind=liekan_analysis_invalidate.kind)
 ORDER BY s.website_id,s.epoch,f.kind
 ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE
 SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp();
END $$;
CREATE OR REPLACE FUNCTION liekan_analysis_visit_evidence_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; changed_sql text; site uuid; gate record; guard_sql text;
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
 IF TG_TABLE_NAME='website_event' AND TG_OP<>'INSERT' THEN
  -- Raw moves/deletes are maintenance; all slots prevent evidence from observing a changing mapping.
  FOR site IN EXECUTE format('SELECT DISTINCT website_id FROM (%s) r ORDER BY website_id',rows_sql) LOOP
   PERFORM liekan_analysis_visit_guard_lock(site,NULL,false);
  END LOOP;
 ELSE
  IF TG_TABLE_NAME='website_event' THEN
   guard_sql:=format('SELECT DISTINCT r.website_id,(get_byte(decode(md5(r.visit_id::text),''hex''),0)%%32)::smallint AS slot
    FROM (%s) r JOIN liekan_analysis_site s USING(website_id) WHERE s.mode=''live'' ORDER BY 1,2',rows_sql);
  ELSE
   -- Freeze the raw tuple before deriving visit/time. NOWAIT avoids raw/evidence reverse lock waits.
   -- The locked subquery retains current values after any completed concurrent raw update (EPQ).
   guard_sql:=format('SELECT DISTINCT locked.website_id,(get_byte(decode(md5(locked.visit_id::text),''hex''),0)%%32)::smallint AS slot
    FROM (SELECT e.website_id,e.visit_id FROM (%s) r JOIN website_event e ON e.website_id=r.website_id AND e.event_id=r.event_id
     JOIN liekan_analysis_site s ON s.website_id=e.website_id WHERE s.mode=''live'' FOR SHARE OF e NOWAIT) locked
    ORDER BY 1,2',rows_sql);
  END IF;
  FOR gate IN EXECUTE guard_sql LOOP
   -- The outer raw INSERT may wait while holding only its own new event/receipt.
   -- The independent marker WITH below starts after this guard acquisition with a fresh snapshot.
   PERFORM liekan_analysis_visit_guard_lock(gate.website_id,gate.slot,TG_TABLE_NAME='website_event' AND TG_OP='INSERT');
  END LOOP;
 END IF;
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


CREATE OR REPLACE FUNCTION liekan_analysis_truncate_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE site uuid; kind text:=NULLIF(TG_ARGV[0],'');
BEGIN
 -- Pin disabled sites too so an enable cannot publish before an in-flight truncate commits.
 FOR site IN SELECT website_id FROM liekan_analysis_site ORDER BY website_id LOOP
  PERFORM liekan_analysis_capture_pin(site);
  IF kind IS NULL OR kind='visit' THEN PERFORM liekan_analysis_visit_guard_lock(site,NULL,false); END IF;
 END LOOP;
 FOR site IN SELECT website_id FROM liekan_analysis_site WHERE mode='live' ORDER BY website_id LOOP
  PERFORM liekan_analysis_invalidate(site,kind);
 END LOOP;
 RETURN NULL;
END $$;

-- Existing capture trigger configs survive CREATE OR REPLACE; bind the new initialization boundary too.
DO $$
BEGIN
 EXECUTE format('ALTER FUNCTION liekan_analysis_visit_guard_init() SET search_path TO %I,pg_temp',current_schema());
END $$;
