-- Exact derived statistics. Raw collection and archived identity evidence remain authoritative.
SET LOCAL lock_timeout TO '2s';
LOCK TABLE website,liekan_log,website_event IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE liekan_analysis_site (
 website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
 epoch bigint NOT NULL DEFAULT 1 CHECK(epoch>0),
 mode text NOT NULL DEFAULT 'live' CHECK(mode IN('live','disabled')),
 path_expansion boolean NOT NULL DEFAULT true,
 visit_expansion boolean NOT NULL DEFAULT true,
 capture_from timestamptz NOT NULL DEFAULT clock_timestamp(),
 revision bigint NOT NULL DEFAULT 1,
 derived_bytes bigint NOT NULL DEFAULT 0 CHECK(derived_bytes>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION liekan_analysis_register(site uuid) RETURNS void LANGUAGE sql AS $$
 INSERT INTO liekan_analysis_site(website_id)
 SELECT w.website_id FROM website w WHERE w.website_id=site AND w.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM liekan_analysis_site s WHERE s.website_id=w.website_id)
 ON CONFLICT DO NOTHING
$$;
INSERT INTO liekan_analysis_site(website_id) SELECT website_id FROM website WHERE deleted_at IS NULL;
CREATE TABLE liekan_analysis_dirty (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 epoch bigint NOT NULL,
 family text NOT NULL CHECK(family IN('log','visit')),
 bucket timestamptz NOT NULL,
 shard smallint NOT NULL CHECK(shard BETWEEN 0 AND 31),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,epoch,family,bucket,shard)
);
CREATE INDEX liekan_analysis_dirty_time ON liekan_analysis_dirty(bucket,website_id,family) WHERE isfinite(bucket);
CREATE TABLE liekan_analysis_meter (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 epoch bigint NOT NULL,
 shard smallint NOT NULL CHECK(shard BETWEEN 0 AND 31),
 bytes bigint NOT NULL DEFAULT 0 CHECK(bytes>=0),
 PRIMARY KEY(website_id,epoch,shard)
);
-- INSERT transition rows contain newly inserted markers, excluding ON CONFLICT updates.
CREATE FUNCTION liekan_analysis_meter_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO liekan_analysis_meter(website_id,epoch,shard,bytes)
 SELECT website_id,epoch,shard,count(*)*512 FROM inserted_markers GROUP BY 1,2,3 ORDER BY 1,2,3
 ON CONFLICT(website_id,epoch,shard) DO UPDATE SET bytes=liekan_analysis_meter.bytes+EXCLUDED.bytes;
 RETURN NULL;
END $$;
CREATE TRIGGER liekan_analysis_meter_capture AFTER INSERT ON liekan_analysis_dirty REFERENCING NEW TABLE AS inserted_markers FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_meter_capture();
CREATE FUNCTION liekan_analysis_meter_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE liekan_analysis_meter m SET bytes=greatest(0,m.bytes-r.bytes)
 FROM (SELECT website_id,epoch,shard,count(*)*512 AS bytes FROM deleted_markers GROUP BY 1,2,3) r
 WHERE m.website_id=r.website_id AND m.epoch=r.epoch AND m.shard=r.shard;
 RETURN NULL;
END $$;
CREATE TRIGGER liekan_analysis_meter_removed AFTER DELETE ON liekan_analysis_dirty REFERENCING OLD TABLE AS deleted_markers FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_meter_removed();
CREATE TABLE liekan_analysis_manifest (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 epoch bigint NOT NULL,
 family text NOT NULL CHECK(family IN('log','visit')),
 bucket timestamptz NOT NULL,
 bucket_end timestamptz NOT NULL CHECK(bucket_end>bucket),
 generation uuid NOT NULL,
 previous_generation uuid,
 build_id uuid,
 fingerprint text NOT NULL,
 versions jsonb NOT NULL,
 row_count bigint NOT NULL CHECK(row_count>=0),
 path_complete boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,epoch,family,bucket)
);
CREATE INDEX liekan_analysis_manifest_ranges ON liekan_analysis_manifest(website_id,epoch,family,bucket_end,bucket);
CREATE TABLE liekan_analysis_log (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 generation uuid NOT NULL,
 grain text NOT NULL CHECK(grain IN('5m','hour')),
 bucket timestamptz NOT NULL,
 dimensions jsonb NOT NULL,
 dimension_key text NOT NULL,
 requests bigint NOT NULL CHECK(requests>=0),
 first_at timestamptz NOT NULL,
 last_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,generation,grain,bucket,dimension_key)
) PARTITION BY RANGE(bucket);
CREATE TABLE liekan_analysis_path (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 generation uuid NOT NULL,
 bucket timestamptz NOT NULL,
 path varchar(500) NOT NULL,
 dimensions jsonb NOT NULL,
 dimension_key text NOT NULL,
 requests bigint NOT NULL CHECK(requests>=0),
 first_at timestamptz NOT NULL,
 last_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,generation,bucket,path,dimension_key)
) PARTITION BY RANGE(bucket);
CREATE TABLE liekan_analysis_generation (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 generation uuid NOT NULL,
 estimated_bytes bigint NOT NULL DEFAULT 0 CHECK(estimated_bytes>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,generation)
);
CREATE TABLE liekan_analysis_build (
 id uuid PRIMARY KEY,
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 actor_id uuid,
 origin_build_id uuid,
 family text NOT NULL DEFAULT 'both' CHECK(family IN('both','log','visit')),
 unit_seconds integer NOT NULL DEFAULT 3600 CHECK(unit_seconds IN(300,3600)),
 epoch bigint NOT NULL,
 range_start timestamptz NOT NULL,
 range_end timestamptz NOT NULL CHECK(range_end>range_start),
 timezone text NOT NULL,
 locale text NOT NULL CHECK(locale IN('zh-CN','en-US')),
 request_id uuid NOT NULL,
 request_hash text NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 status text NOT NULL CHECK(status IN('queued','running','paused','completed','failed','invalidated','capacity_limited')),
 work_total bigint NOT NULL,
 work_done bigint NOT NULL DEFAULT 0,
 checkpoint jsonb NOT NULL DEFAULT '{}',
 lease_token uuid,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(website_id,request_id)
);
CREATE INDEX liekan_analysis_build_pending ON liekan_analysis_build(next_attempt_at,created_at) WHERE status IN('queued','running');
CREATE TABLE liekan_analysis_operation (
 website_id uuid NOT NULL REFERENCES liekan_analysis_site(website_id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 request_hash text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(website_id,request_id)
);

CREATE FUNCTION liekan_analysis_versions(site uuid,engine text,traffic text,population text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('engine',engine,'traffic',traffic,'population',population,
  'website',jsonb_build_array(w.user_id,w.team_id,w.domain,w.reset_at,w.deleted_at),
  'policy',(SELECT to_jsonb(p) FROM liekan_collection_policy p WHERE p.website_id=w.website_id),
  'logPolicy',(SELECT jsonb_build_array(l.epoch,l.policy_revision) FROM liekan_log_state l WHERE l.website_id=w.website_id),
  'repair',(SELECT jsonb_build_array(r.active_generation,r.active_revision) FROM liekan_history_repair_run r WHERE r.website_id=w.website_id),
  'registry',(SELECT jsonb_build_array(c.version,c.revision) FROM liekan_crawler_registry_current c WHERE c.id=1))
 FROM website w WHERE w.website_id=site AND w.deleted_at IS NULL
$$;

-- Each marker covers one writer shard. Parent manifests are checked by readers and publishers.
CREATE FUNCTION liekan_analysis_fingerprint(site uuid,epoch_id bigint,kind text,starts timestamptz,ends timestamptz)
RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(coalesce(string_agg(extract(epoch FROM d.bucket)::text||':'||d.shard::text||':'||d.revision::text,',' ORDER BY d.bucket,d.shard),''),'UTF8')),'hex')
 FROM liekan_analysis_dirty d WHERE d.website_id=site AND d.epoch=epoch_id AND d.family=kind
 AND ((d.bucket>=starts AND d.bucket<ends) OR d.bucket='-infinity'::timestamptz)
$$;
CREATE FUNCTION liekan_analysis_invalidate(site uuid,kind text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
 SELECT s.website_id,s.epoch,f.kind,'-infinity'::timestamptz,0
 FROM liekan_analysis_site s CROSS JOIN (VALUES('log'),('visit')) f(kind)
 WHERE s.website_id=site AND s.mode='live' AND (kind IS NULL OR f.kind=kind)
 ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE
 SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp()
$$;
CREATE FUNCTION liekan_analysis_log_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text;
BEGIN
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows' ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows' END;
 EXECUTE format('INSERT INTO liekan_analysis_site(website_id)
  SELECT DISTINCT r.website_id FROM (%s) r JOIN website w ON w.website_id=r.website_id
  WHERE w.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM liekan_analysis_site s WHERE s.website_id=r.website_id) ON CONFLICT DO NOTHING',rows_sql);
 EXECUTE format('INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT r.website_id,s.epoch,''log'',date_bin(interval ''5 minutes'',r.created_at,timestamptz ''2000-01-01Z''),
   (get_byte(decode(md5(r.id),''hex''),0) %% 32)::smallint
  FROM (%s) r JOIN liekan_analysis_site s USING(website_id) WHERE s.mode=''live'' AND r.created_at IS NOT NULL
  ORDER BY r.website_id,s.epoch,4,5
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp()',rows_sql);
 RETURN NULL;
END $$;
CREATE TRIGGER liekan_analysis_log_insert AFTER INSERT ON liekan_log REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_log_capture();
CREATE TRIGGER liekan_analysis_log_update AFTER UPDATE ON liekan_log REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_log_capture();
CREATE TRIGGER liekan_analysis_log_delete AFTER DELETE ON liekan_log REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_log_capture();

-- Secondary evidence, policy and source mutations use one bounded family marker per site.
CREATE FUNCTION liekan_analysis_secondary_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text; projection text; site uuid;
BEGIN
 IF TG_OP='INSERT' AND TG_TABLE_NAME='session' THEN
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
CREATE FUNCTION liekan_analysis_truncate_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE site uuid;
BEGIN
 FOR site IN SELECT website_id FROM liekan_analysis_site WHERE mode='live' ORDER BY website_id LOOP
  PERFORM liekan_analysis_register(site);
  PERFORM liekan_analysis_invalidate(site,NULLIF(TG_ARGV[0],''));
 END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER liekan_analysis_log_truncate AFTER TRUNCATE ON liekan_log FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_truncate_capture('log');
DO $$
DECLARE tab text; kind text;
BEGIN
 FOR tab,kind IN SELECT * FROM (VALUES
 ('liekan_log_interval','log'),('liekan_log_source','log'),
 ('liekan_log_state','log'),('liekan_history_repair_run',''),
 ('liekan_history_repair_result',''),('liekan_collection_policy','visit'),('liekan_collection_hostname','visit'),
 ('session','visit')) x(tab,kind) LOOP
  EXECUTE format('CREATE TRIGGER analysis_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_secondary_capture(%L)',tab,kind);
  EXECUTE format('CREATE TRIGGER analysis_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_secondary_capture(%L)',tab,kind);
  EXECUTE format('CREATE TRIGGER analysis_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_secondary_capture(%L)',tab,kind);
  EXECUTE format('CREATE TRIGGER analysis_truncate AFTER TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_truncate_capture(%L)',tab,kind);
 END LOOP;
END $$;
CREATE FUNCTION liekan_analysis_website_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO liekan_analysis_site(website_id) VALUES(NEW.website_id) ON CONFLICT DO NOTHING;
 ELSIF (NEW.user_id,NEW.team_id,NEW.reset_at,NEW.deleted_at,NEW.domain) IS DISTINCT FROM (OLD.user_id,OLD.team_id,OLD.reset_at,OLD.deleted_at,OLD.domain) THEN
  UPDATE liekan_analysis_site SET epoch=epoch+1,revision=revision+1,path_expansion=true,visit_expansion=true,capture_from=clock_timestamp(),updated_at=clock_timestamp() WHERE website_id=NEW.website_id;
  UPDATE liekan_analysis_build SET status='invalidated',lease_token=NULL,lease_until=NULL,error_code='website-changed',revision=revision+1,updated_at=clock_timestamp() WHERE website_id=NEW.website_id AND status IN('queued','running','paused');
  INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision) VALUES('website',NEW.website_id,1)
  ON CONFLICT(resource_type,resource_id) DO UPDATE SET revision=liekan_analytics_revision.revision+1,updated_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER liekan_analysis_website_insert AFTER INSERT ON website FOR EACH ROW EXECUTE FUNCTION liekan_analysis_website_lifecycle();
CREATE TRIGGER liekan_analysis_website_update AFTER UPDATE ON website FOR EACH ROW EXECUTE FUNCTION liekan_analysis_website_lifecycle();

-- New identity bindings only invalidate their own raw log leaves.
CREATE FUNCTION liekan_analysis_identity_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rows_sql text;
BEGIN
 rows_sql:=CASE TG_OP WHEN 'INSERT' THEN 'SELECT * FROM new_rows' WHEN 'DELETE' THEN 'SELECT * FROM old_rows' ELSE 'SELECT * FROM old_rows UNION ALL SELECT * FROM new_rows' END;
 EXECUTE format('INSERT INTO liekan_analysis_site(website_id)
  SELECT DISTINCT r.website_id FROM (%s) r JOIN website w ON w.website_id=r.website_id
  WHERE w.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM liekan_analysis_site s WHERE s.website_id=r.website_id) ON CONFLICT DO NOTHING',rows_sql);
 EXECUTE format('INSERT INTO liekan_analysis_dirty(website_id,epoch,family,bucket,shard)
  SELECT DISTINCT l.website_id,s.epoch,''log'',date_bin(interval ''5 minutes'',l.created_at,timestamptz ''2000-01-01Z''),(get_byte(decode(md5(l.id),''hex''),0) %% 32)::smallint
  FROM (%s) r JOIN liekan_log l ON l.website_id=r.website_id AND l.id=r.log_id JOIN liekan_analysis_site s ON s.website_id=l.website_id
  WHERE s.mode=''live'' ORDER BY 1,2,4,5
  ON CONFLICT(website_id,epoch,family,bucket,shard) DO UPDATE SET revision=liekan_analysis_dirty.revision+1,updated_at=clock_timestamp()',rows_sql);
 RETURN NULL;
END $$;
CREATE TRIGGER analysis_insert AFTER INSERT ON liekan_crawler_evidence REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_identity_capture();
CREATE TRIGGER analysis_update AFTER UPDATE ON liekan_crawler_evidence REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_identity_capture();
CREATE TRIGGER analysis_delete AFTER DELETE ON liekan_crawler_evidence REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_identity_capture();
CREATE TRIGGER analysis_truncate AFTER TRUNCATE ON liekan_crawler_evidence FOR EACH STATEMENT EXECUTE FUNCTION liekan_analysis_truncate_capture('log');

-- Digest indexes remain bounded. Full canonical dimensions must also compare equal before merging.
CREATE FUNCTION liekan_analysis_merge_count(existing jsonb,candidate jsonb,previous_count bigint,delta bigint)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF existing IS DISTINCT FROM candidate THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='analysis-dimension-collision';
 END IF;
 RETURN previous_count+delta;
END $$;

-- The website table lock covers registration and trigger installation in one migration transaction.
INSERT INTO liekan_analysis_site(website_id) SELECT website_id FROM website WHERE deleted_at IS NULL ON CONFLICT DO NOTHING;
