SET LOCAL lock_timeout TO '2s';
-- Exact hourly visit facts retain IDs so visitors and visits merge across bucket/day boundaries.
CREATE TABLE liekan_analysis_visit (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 generation uuid NOT NULL,
 bucket timestamptz NOT NULL,
 session_id uuid NOT NULL,
 visit_id uuid NOT NULL,
 hostname text NOT NULL DEFAULT '',
 dimensions jsonb NOT NULL,
 dimension_key text NOT NULL,
 pageviews bigint NOT NULL CHECK(pageviews>=0),
 has_custom boolean NOT NULL,
 min_time timestamptz,
 max_time timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,generation,bucket,session_id,visit_id,hostname,dimension_key)
) PARTITION BY RANGE(bucket);
CREATE INDEX liekan_analysis_visit_merge ON liekan_analysis_visit(website_id,session_id,visit_id,bucket);
CREATE FUNCTION liekan_analysis_visit_evidence_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; targets_sql text; touched jsonb; touched_count integer; sites uuid[]; site uuid;
BEGIN
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows' ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows' END;
 EXECUTE format('SELECT array_agg(DISTINCT website_id) FROM (%s) r',rows_sql) INTO sites;
 FOREACH site IN ARRAY coalesce(sites,'{}'::uuid[]) LOOP PERFORM liekan_analysis_register(site); END LOOP;
 IF TG_TABLE_NAME='website_event' THEN
  targets_sql:=format('SELECT DISTINCT website_id,visit_id FROM (%s) r',rows_sql);
 ELSE
  targets_sql:=format('SELECT DISTINCT e.website_id,e.visit_id FROM (%s) r JOIN website_event e ON e.website_id=r.website_id AND e.event_id=r.event_id',rows_sql);
 END IF;
 -- The visit index bounds every probe. Large visits conservatively invalidate their family.
 EXECUTE format('WITH targets AS (%s), affected AS (
  SELECT e.website_id,e.created_at,e.event_id FROM targets t CROSS JOIN LATERAL (
   SELECT e.website_id,e.created_at,e.event_id FROM website_event e WHERE e.website_id=t.website_id AND e.visit_id=t.visit_id LIMIT 2001
  ) e LIMIT 2001)
 SELECT count(*)::int,coalesce(jsonb_agg(jsonb_build_object(''website_id'',website_id,''created_at'',created_at,''event_id'',event_id)),''[]''::jsonb) FROM affected',targets_sql) INTO touched_count,touched;
 IF touched_count>=2001 THEN
  FOREACH site IN ARRAY coalesce(sites,'{}'::uuid[]) LOOP PERFORM liekan_analysis_invalidate(site,'visit'); END LOOP;
 ELSE
  INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
   SELECT DISTINCT r.website_id,s.epoch,'visit',date_bin(interval '1 hour',r.created_at,timestamptz '2000-01-01Z'),(get_byte(decode(md5(r.event_id::text),'hex'),0) % 32)::smallint
   FROM jsonb_to_recordset(touched) AS r(website_id uuid,created_at timestamptz,event_id uuid) JOIN liekan_analysis_site s USING(website_id)
   WHERE s.mode='live' AND r.created_at IS NOT NULL ORDER BY 1,2,4,5
   ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp();
 END IF;
 -- Deleted/moved raw events still mark both old and new leaves from transition rows.
 IF TG_TABLE_NAME='website_event' THEN
  EXECUTE format('INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
   SELECT DISTINCT r.website_id,s.epoch,''visit'',date_bin(interval ''1 hour'',r.created_at,timestamptz ''2000-01-01Z''),(get_byte(decode(md5(r.event_id::text),''hex''),0) %% 32)::smallint
   FROM (%s) r JOIN liekan_analysis_site s USING(website_id) WHERE s.mode=''live'' AND r.created_at IS NOT NULL ORDER BY 1,2,4,5
   ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp()',rows_sql);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER liekan_analysis_visit_insert AFTER INSERT ON website_event REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture();
CREATE TRIGGER liekan_analysis_visit_update AFTER UPDATE ON website_event REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture();
CREATE TRIGGER liekan_analysis_visit_delete AFTER DELETE ON website_event REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture();
CREATE TRIGGER liekan_analysis_visit_truncate AFTER TRUNCATE ON website_event FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_truncate_capture('visit');

DO $$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['liekan_event_quality','liekan_event_geography'] LOOP
  EXECUTE format('CREATE TRIGGER analysis_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture()',tab);
  EXECUTE format('CREATE TRIGGER analysis_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture()',tab);
  EXECUTE format('CREATE TRIGGER analysis_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture()',tab);
  EXECUTE format('CREATE TRIGGER analysis_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_truncate_capture(''visit'')',tab);
 END LOOP;
END $$;
