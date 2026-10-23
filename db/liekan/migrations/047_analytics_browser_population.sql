-- Exact browser-population facts retain event-owned identity evidence and correction boundaries.
SET LOCAL lock_timeout TO '2s';
ALTER TABLE liekan_analysis_visit ADD COLUMN eligible_events bigint NOT NULL DEFAULT 0 CHECK(eligible_events>=0);

-- Facts carry event-owned population evidence. Ordinary data corrections remain leaf-scoped.
CREATE OR REPLACE FUNCTION liekan_analysis_versions(site uuid,engine text,traffic text,population text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('engine',engine,'traffic',traffic,'population',population,
  'website',jsonb_build_array(w.user_id,w.team_id,w.domain,w.reset_at,w.deleted_at),
  'policy',(SELECT to_jsonb(p) FROM liekan_collection_policy p WHERE p.website_id=w.website_id),
  'logPolicy',(SELECT jsonb_build_array(l.epoch,l.policy_revision) FROM liekan_log_state l WHERE l.website_id=w.website_id),
  'repair',(SELECT jsonb_build_array(r.active_generation,r.active_revision) FROM liekan_history_repair_run r
   WHERE r.website_id=w.website_id AND r.campaign_id='traffic-quality-repair-20261022-v1'),
  'governance',coalesce((SELECT g.revision::text FROM liekan_traffic_governance g WHERE g.website_id=w.website_id),'0'),
  'registry',(SELECT jsonb_build_array(c.version,c.revision) FROM liekan_crawler_registry_current c WHERE c.id=1))
 FROM website w WHERE w.website_id=site AND w.deleted_at IS NULL
$$;

-- The existing bounded evidence capture pins epoch, freezes the event mapping, and takes visit guards.
CREATE TRIGGER analysis_insert AFTER INSERT ON liekan_event_environment REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture();
CREATE TRIGGER analysis_update AFTER UPDATE ON liekan_event_environment REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture();
CREATE TRIGGER analysis_delete AFTER DELETE ON liekan_event_environment REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_visit_evidence_capture();
CREATE TRIGGER analysis_truncate AFTER TRUNCATE ON liekan_event_environment FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_truncate_capture('visit');

CREATE FUNCTION liekan_analysis_population_revision(site uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision)
 SELECT 'website',w.website_id,1 FROM website w WHERE w.website_id=site AND w.deleted_at IS NULL
 ON CONFLICT(resource_type,resource_id) DO UPDATE
 SET revision=liekan_analytics_revision.revision+1,updated_at=clock_timestamp();
END $$;

CREATE FUNCTION liekan_analysis_environment_revision_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE site uuid; rows_sql text;
BEGIN
 IF TG_OP='TRUNCATE' THEN
  FOR site IN SELECT website_id FROM liekan_analysis_site ORDER BY website_id LOOP
   PERFORM liekan_analysis_population_revision(site);
  END LOOP;
  RETURN NULL;
 END IF;
 IF TG_OP='INSERT' THEN
  -- A primary-key lookup preserves the live TTL and strongly fences late/earlier-anchor evidence.
  FOR site IN SELECT DISTINCT r.website_id FROM new_rows r JOIN LATERAL(
   SELECT e.* FROM website_event e WHERE e.event_id=r.event_id
    AND e.website_id=(SELECT r.website_id OFFSET 0) OFFSET 0) e ON true
   WHERE e.created_at<clock_timestamp()-interval '60 seconds' OR EXISTS(
    SELECT 1 FROM website_event later WHERE later.website_id=e.website_id AND later.session_id=e.session_id
    AND later.visit_id=e.visit_id AND later.event_type NOT IN(2,5)
    AND (later.created_at,later.event_id)>(e.created_at,e.event_id)) ORDER BY r.website_id
  LOOP PERFORM liekan_analysis_population_revision(site); END LOOP;
 ELSE
  rows_sql:=CASE TG_OP WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
   ELSE '(SELECT * FROM old_rows EXCEPT SELECT * FROM new_rows) UNION ALL (SELECT * FROM new_rows EXCEPT SELECT * FROM old_rows)' END;
  FOR site IN EXECUTE format('SELECT DISTINCT website_id FROM (%s) r ORDER BY website_id',rows_sql) LOOP
   PERFORM liekan_analysis_population_revision(site);
  END LOOP;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION liekan_analysis_governance_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE site uuid; rows_sql text; projection text;
BEGIN
 IF TG_OP='TRUNCATE' THEN
  -- All disabled/live epochs are pinned before a family invalidation can be published.
  FOR site IN SELECT website_id FROM liekan_analysis_site ORDER BY website_id LOOP
   PERFORM liekan_analysis_capture_pin(site);
  END LOOP;
  FOR site IN SELECT website_id FROM liekan_analysis_site ORDER BY website_id LOOP
   PERFORM liekan_analysis_invalidate(site,'visit');
   PERFORM liekan_analysis_population_revision(site);
  END LOOP;
  RETURN NULL;
 END IF;
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows'
  ELSE '(SELECT * FROM old_rows EXCEPT SELECT * FROM new_rows) UNION ALL (SELECT * FROM new_rows EXCEPT SELECT * FROM old_rows)' END;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN('liekan_traffic_governance','liekan_traffic_exclusion') THEN
  projection:=CASE TG_TABLE_NAME WHEN 'liekan_traffic_governance' THEN 'r.website_id,r.revision'
   ELSE 'r.id,r.website_id,r.epoch,r.state,r.received_cutoff' END;
  rows_sql:=format('(SELECT %1$s FROM old_rows r EXCEPT SELECT %1$s FROM new_rows r)
   UNION ALL (SELECT %1$s FROM new_rows r EXCEPT SELECT %1$s FROM old_rows r)',projection);
 END IF;
 IF TG_TABLE_NAME='liekan_traffic_governance' THEN
  -- Creating the revision-zero row for a preview preserves the current population identity.
  rows_sql:=format('SELECT website_id FROM (%s) r WHERE revision<>0',rows_sql);
 ELSIF TG_TABLE_NAME='liekan_traffic_exclusion' THEN
  rows_sql:=format('SELECT website_id FROM (%s) r WHERE state=''active''
   AND epoch=coalesce((SELECT l.epoch FROM liekan_log_state l WHERE l.website_id=r.website_id),1)',rows_sql);
 ELSE
  -- Preview membership is inert; active membership changes the effective population atomically.
  rows_sql:=format('SELECT r.website_id FROM (%s) r JOIN liekan_traffic_exclusion x
   ON x.website_id=r.website_id AND x.id=r.collection_id WHERE x.state=''active''
   AND x.epoch=coalesce((SELECT l.epoch FROM liekan_log_state l WHERE l.website_id=x.website_id),1)',rows_sql);
 END IF;
 FOR site IN EXECUTE format('SELECT DISTINCT website_id FROM (%s) r ORDER BY website_id',rows_sql) LOOP
  PERFORM liekan_analysis_invalidate(site,'visit');
  PERFORM liekan_analysis_population_revision(site);
 END LOOP;
 RETURN NULL;
END $$;

DO $$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['liekan_traffic_governance','liekan_traffic_exclusion','liekan_traffic_exclusion_member'] LOOP
  EXECUTE format('CREATE TRIGGER analysis_population_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_governance_capture()',tab);
  EXECUTE format('CREATE TRIGGER analysis_population_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_governance_capture()',tab);
  EXECUTE format('CREATE TRIGGER analysis_population_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_governance_capture()',tab);
  EXECUTE format('CREATE TRIGGER analysis_population_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_governance_capture()',tab);
 END LOOP;
 EXECUTE format('ALTER FUNCTION liekan_analysis_environment_revision_capture() SET search_path TO %I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION liekan_analysis_governance_capture() SET search_path TO %I,pg_temp',current_schema());
END $$;
CREATE TRIGGER analysis_population_insert AFTER INSERT ON liekan_event_environment REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_environment_revision_capture();
CREATE TRIGGER analysis_population_update AFTER UPDATE ON liekan_event_environment REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_environment_revision_capture();
CREATE TRIGGER analysis_population_delete AFTER DELETE ON liekan_event_environment REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_environment_revision_capture();
CREATE TRIGGER analysis_population_truncate AFTER TRUNCATE ON liekan_event_environment FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_environment_revision_capture();
