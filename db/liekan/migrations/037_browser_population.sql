-- Preserve original collection facts while binding reporting to resource and source evidence.
SET LOCAL lock_timeout TO '5s';
ALTER TABLE liekan_collection_receipt ADD COLUMN collection_source text
  CHECK(collection_source IN('browser','authenticated_server','legacy_override'));
ALTER TABLE liekan_collection_receipt ADD COLUMN collection_scope text;

CREATE TABLE liekan_session_source (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES session(session_id) ON DELETE CASCADE,
  source text NOT NULL CHECK(source IN('browser','authenticated_server','legacy_override')),
  scope text NOT NULL CHECK(scope IN('browser','browser_unresolved','browser_automated','browser_conflicted','authenticated_server','legacy_override')),
  identity_version text NOT NULL,
  identity_available boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(website_id,session_id)
);
CREATE TABLE liekan_session_data_source (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  data_key varchar(500) NOT NULL,
  scope text NOT NULL,
  hostname text, origin_hostname text, classification text NOT NULL,
  row_digest varchar(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(website_id,session_id,data_key),
  FOREIGN KEY(session_id,data_key) REFERENCES session_data(session_id,data_key) ON DELETE CASCADE
);
CREATE TABLE liekan_session_link_source (
  website_id uuid NOT NULL,
  session_id uuid NOT NULL,
  distinct_id varchar(50) NOT NULL,
  scope text NOT NULL,
  hostname text, origin_hostname text, classification text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(website_id,session_id,distinct_id),
  FOREIGN KEY(website_id,distinct_id,session_id) REFERENCES session_link(website_id,distinct_id,session_id) ON DELETE CASCADE
);
CREATE TABLE liekan_event_environment (
  event_id uuid PRIMARY KEY REFERENCES website_event(event_id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  scope text NOT NULL,
  identity_version text NOT NULL,
  identity_available boolean NOT NULL,
  browser varchar(20), os varchar(20), device varchar(20), screen varchar(11), language varchar(35),
  origin_hostname text,
  distinct_id varchar(50),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX liekan_event_environment_site ON liekan_event_environment(website_id,event_id);

CREATE TABLE liekan_traffic_governance (
  website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE liekan_traffic_exclusion (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  epoch bigint NOT NULL,
  actor_id uuid NOT NULL,
  state text NOT NULL CHECK(state IN('preview','active','revoked','expired')),
  base_revision bigint NOT NULL,
  policy_revision bigint NOT NULL,
  rule_version text NOT NULL,
  catalog_version uuid,
  history_generation uuid,
  history_revision bigint NOT NULL DEFAULT 0,
  window_end timestamptz NOT NULL,
  received_cutoff timestamptz NOT NULL,
  membership_digest varchar(64) NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX liekan_traffic_exclusion_active ON liekan_traffic_exclusion(website_id,epoch,id) WHERE state='active';
CREATE TABLE liekan_traffic_exclusion_member (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES liekan_traffic_exclusion(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES website_event(event_id) ON DELETE CASCADE,
  PRIMARY KEY(website_id,collection_id,event_id)
);
CREATE INDEX liekan_traffic_exclusion_event ON liekan_traffic_exclusion_member(website_id,event_id,collection_id);
CREATE TABLE liekan_traffic_governance_revision (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  revision bigint NOT NULL,
  actor_id uuid NOT NULL,
  collection_id uuid NOT NULL REFERENCES liekan_traffic_exclusion(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK(operation IN('confirm','revoke')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(website_id,revision)
);

-- One installed repair campaign owns classification overlays. New campaigns require an explicit reader upgrade.
CREATE OR REPLACE VIEW liekan_reporting_event_quality AS
SELECT q.event_id,q.website_id,
  coalesce(r.after_value->>'classification',q.classification) AS classification,
  q.source,
  CASE WHEN r.record_id IS NULL THEN q.reasons ELSE ARRAY(SELECT jsonb_array_elements_text(r.after_value->'reasons')) END AS reasons,
  coalesce(r.after_value->>'ruleVersion',q.rule_version) AS rule_version,
  q.range_version,q.range_status,q.hostname,q.created_at,
 CASE WHEN r.proof ? 'catalogVersion' THEN nullif(r.proof->>'catalogVersion','')::uuid ELSE q.catalog_version END AS catalog_version,q.repair_scope_id
FROM liekan_event_quality q
LEFT JOIN liekan_history_repair_run run ON run.website_id=q.website_id
 AND run.campaign_id='traffic-quality-repair-20261022-v1'
LEFT JOIN liekan_history_repair_result r ON r.run_id=run.id AND r.generation=run.active_generation
 AND r.kind='event' AND r.record_id=q.event_id::text AND r.issue IS NULL;

CREATE VIEW liekan_admissible_browser_event AS
SELECT e.* FROM website_event e
JOIN website w ON w.website_id=e.website_id AND w.deleted_at IS NULL
JOIN liekan_reporting_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
LEFT JOIN liekan_event_environment env ON env.event_id=e.event_id AND env.website_id=e.website_id
LEFT JOIN liekan_collection_policy p ON p.website_id=e.website_id
LEFT JOIN liekan_collection_hostname h ON h.website_id=e.website_id
 AND q.hostname IS NULL AND cardinality(p.allowed_hostnames)>0
 AND h.reported_hash=encode(sha256(convert_to(e.hostname,'UTF8')),'hex')
WHERE e.event_type IN(1,2,5) AND q.source='browser'
 AND q.classification<>'automated' AND NOT('bot_check_disabled'=ANY(q.reasons))
 AND (coalesce(p.mode,'standard')<>'strict' OR q.classification<>'suspected')
 AND (coalesce(cardinality(p.allowed_hostnames),0)=0 OR (
   coalesce(q.hostname,h.hostname)=ANY(p.allowed_hostnames)
   AND (env.origin_hostname IS NULL OR env.origin_hostname=ANY(p.allowed_hostnames))
 ));

CREATE VIEW liekan_effective_browser_event AS
SELECT e.* FROM liekan_admissible_browser_event e
WHERE NOT EXISTS (
   SELECT 1 FROM liekan_traffic_exclusion_member m
   JOIN liekan_traffic_exclusion x ON x.id=m.collection_id AND x.website_id=m.website_id
   LEFT JOIN liekan_log_state ls ON ls.website_id=x.website_id
   WHERE m.website_id=e.website_id AND m.event_id=e.event_id AND x.state='active' AND x.epoch=coalesce(ls.epoch,1)
 );

CREATE VIEW liekan_effective_link_event AS
SELECT e.* FROM website_event e JOIN link l ON l.link_id=e.website_id AND l.deleted_at IS NULL
WHERE e.event_type=3 AND NOT EXISTS(SELECT 1 FROM website w WHERE w.website_id=e.website_id);
CREATE VIEW liekan_effective_pixel_event AS
SELECT e.* FROM website_event e JOIN pixel p ON p.pixel_id=e.website_id AND p.deleted_at IS NULL
WHERE e.event_type=4 AND NOT EXISTS(SELECT 1 FROM website w WHERE w.website_id=e.website_id)
 AND NOT EXISTS(SELECT 1 FROM link l WHERE l.link_id=e.website_id);

-- Each branch obtains its resource kind from database metadata, never from a query parameter.
CREATE OR REPLACE VIEW liekan_effective_website_event AS
SELECT * FROM liekan_effective_browser_event
UNION ALL SELECT * FROM liekan_effective_link_event
UNION ALL SELECT * FROM liekan_effective_pixel_event;

CREATE OR REPLACE VIEW liekan_geographic_website_event AS
SELECT e.*, CASE WHEN g.event_id IS NOT NULL THEN g.country ELSE s.country END AS liekan_country,
  CASE WHEN g.event_id IS NOT NULL THEN g.region ELSE s.region END AS liekan_region,
  CASE WHEN g.event_id IS NOT NULL THEN g.city ELSE s.city END AS liekan_city,
  CASE WHEN e.event_type IN(3,4) THEN s.browser ELSE env.browser END AS liekan_browser,
  CASE WHEN e.event_type IN(3,4) THEN s.os ELSE env.os END AS liekan_os,
  CASE WHEN e.event_type IN(3,4) THEN s.device ELSE env.device END AS liekan_device,
  CASE WHEN e.event_type IN(3,4) THEN s.screen ELSE env.screen END AS liekan_screen,
  CASE WHEN e.event_type IN(3,4) THEN s.language ELSE env.language END AS liekan_language,
  coalesce(env.identity_available,e.event_type IN(3,4)) AS liekan_identity_available
FROM liekan_effective_website_event e
JOIN session s ON s.session_id=e.session_id AND s.website_id=e.website_id
LEFT JOIN LATERAL (
  SELECT a.event_id FROM liekan_effective_website_event a
  WHERE a.website_id=e.website_id AND a.session_id=e.session_id AND a.visit_id=e.visit_id
    AND a.event_type NOT IN(2,5)
  ORDER BY a.created_at,a.event_id LIMIT 1
) anchor ON true
LEFT JOIN liekan_event_geography g ON g.website_id=e.website_id AND g.event_id=anchor.event_id
LEFT JOIN liekan_event_environment env ON env.website_id=e.website_id AND env.event_id=e.event_id;

-- Native profile and replay readers see only eligible sessions, with event-owned dimensions.
CREATE VIEW liekan_effective_session AS
SELECT s.session_id,s.website_id,
  CASE WHEN latest.event_type IN(3,4) THEN s.browser ELSE env.browser END AS browser,
  CASE WHEN latest.event_type IN(3,4) THEN s.os ELSE env.os END AS os,
  CASE WHEN latest.event_type IN(3,4) THEN s.device ELSE env.device END AS device,
  CASE WHEN latest.event_type IN(3,4) THEN s.screen ELSE env.screen END AS screen,
  CASE WHEN latest.event_type IN(3,4) THEN s.language ELSE env.language END AS language,
  s.country,s.region,s.city,
  CASE WHEN latest.event_type IN(3,4) THEN s.distinct_id ELSE env.distinct_id END AS distinct_id,
  s.created_at
FROM session s
JOIN LATERAL (SELECT e.event_id,e.event_type FROM liekan_effective_website_event e
 WHERE e.website_id=s.website_id AND e.session_id=s.session_id ORDER BY e.created_at DESC,e.event_id DESC LIMIT 1) latest ON true
LEFT JOIN liekan_event_environment env ON env.website_id=s.website_id AND env.event_id=latest.event_id;

CREATE FUNCTION liekan_session_data_digest(d session_data) RETURNS text LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array(d.session_data_id,d.website_id,d.session_id,d.data_key,
   d.distinct_id,d.string_value,d.number_value,extract(epoch FROM d.date_value),d.data_type,extract(epoch FROM d.created_at))::text,'UTF8')),'hex')
$$;
CREATE VIEW liekan_effective_session_data AS
SELECT d.* FROM session_data d
JOIN liekan_session_data_source src ON src.website_id=d.website_id AND src.session_id=d.session_id AND src.data_key=d.data_key
LEFT JOIN liekan_collection_policy p ON p.website_id=d.website_id
WHERE src.scope='browser' AND src.row_digest=liekan_session_data_digest(d)
 AND (coalesce(p.mode,'standard')<>'strict' OR src.classification<>'suspected')
 AND (coalesce(cardinality(p.allowed_hostnames),0)=0 OR (src.hostname=ANY(p.allowed_hostnames)
   AND (src.origin_hostname IS NULL OR src.origin_hostname=ANY(p.allowed_hostnames))))
 AND EXISTS(SELECT 1 FROM liekan_effective_browser_event e WHERE e.website_id=d.website_id AND e.session_id=d.session_id);
CREATE VIEW liekan_effective_session_link AS
SELECT l.* FROM session_link l
JOIN liekan_session_link_source src ON src.website_id=l.website_id AND src.session_id=l.session_id AND src.distinct_id=l.distinct_id
LEFT JOIN liekan_collection_policy p ON p.website_id=l.website_id
WHERE src.scope='browser' AND (coalesce(p.mode,'standard')<>'strict' OR src.classification<>'suspected')
 AND (coalesce(cardinality(p.allowed_hostnames),0)=0 OR (src.hostname=ANY(p.allowed_hostnames)
   AND (src.origin_hostname IS NULL OR src.origin_hostname=ANY(p.allowed_hostnames))))
 AND EXISTS(SELECT 1 FROM liekan_effective_browser_event e WHERE e.website_id=l.website_id AND e.session_id=l.session_id);

-- Revisions invalidate already materialized reports after this mandatory population change.
INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision)
SELECT 'website',website_id,1 FROM website
ON CONFLICT(resource_type,resource_id) DO UPDATE
 SET revision=liekan_analytics_revision.revision+1,updated_at=clock_timestamp();

CREATE OR REPLACE VIEW liekan_reporting_log AS
SELECT l.id,l.website_id,l.import_id,l.created_at,l.path,l.method,l.status,l.bytes,l.ip_masked,l.ip_hash,l.user_agent,l.location,
 coalesce(r.after_value->>'bot',l.bot) AS bot,
 coalesce(r.after_value->>'vendor',l.vendor) AS vendor,
 coalesce(r.after_value->>'botType',l.bot_type) AS bot_type,
 coalesce(r.after_value->>'verification',l.verification) AS verification,
 l.source_id,l.event_digest,
 CASE WHEN r.record_id IS NULL THEN l.verification_version ELSE r.after_value->>'verificationVersion' END AS verification_version,
 CASE WHEN r.record_id IS NULL THEN l.ai_eligible ELSE (r.after_value->>'aiEligible')::boolean END AS ai_eligible,
 coalesce(r.after_value->>'recognitionState',l.recognition_state) AS recognition_state,
 CASE WHEN r.record_id IS NULL THEN l.recognition_candidates ELSE r.after_value->'recognitionCandidates' END AS recognition_candidates,
 CASE WHEN r.record_id IS NULL THEN l.verification_observed_at ELSE (r.after_value->>'verificationObservedAt')::timestamptz END AS verification_observed_at,
 CASE WHEN r.record_id IS NULL THEN l.verification_reason ELSE r.after_value->>'verificationReason' END AS verification_reason,
 CASE WHEN r.record_id IS NULL THEN e.crawler_id ELSE r.after_value->>'crawlerId' END AS reporting_crawler_id,
 CASE WHEN r.record_id IS NULL THEN e.catalog_version ELSE (r.proof->>'catalogVersion')::uuid END AS reporting_catalog_version,
 CASE WHEN r.record_id IS NULL THEN e.classification_version ELSE r.proof->>'rulepack' END AS reporting_classification_version,
 run.active_generation AS reporting_generation
FROM liekan_effective_log l
LEFT JOIN liekan_crawler_evidence e ON e.website_id=l.website_id AND e.log_id=l.id
LEFT JOIN liekan_history_repair_run run ON run.website_id=l.website_id
 AND run.campaign_id='traffic-quality-repair-20261022-v1'
LEFT JOIN liekan_history_repair_result r ON r.run_id=run.id AND r.generation=run.active_generation
 AND r.kind='log' AND r.record_id=l.id;

-- Existing previews retain unknown identity coverage until an explicit new preview is prepared.
ALTER TABLE liekan_history_repair_day ADD COLUMN before_identity_missing_pv bigint,
  ADD COLUMN after_identity_missing_pv bigint;


-- Fence older workers during rolling deployment while preserving active/rollback generations.
UPDATE liekan_history_repair_campaign SET engine_version='history-repair-v1.2',
  lease_token=NULL,lease_until=NULL,lease_run_id=NULL
WHERE id='traffic-quality-repair-20261022-v1';
UPDATE liekan_history_repair_run SET status='invalidated',revision=revision+1,
  error_code='history-repair-engine-changed',lease_token=NULL,lease_until=NULL,queued_job_id=NULL,updated_at=clock_timestamp()
WHERE campaign_id='traffic-quality-repair-20261022-v1'
 AND snapshot#>>'{rulepack,engine}' IS DISTINCT FROM 'history-repair-v1.2'
 AND status IN('scanning','preparing','ready','queued','running','validating','paused','failed');
CREATE FUNCTION liekan_repair_engine_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.campaign_id='traffic-quality-repair-20261022-v1'
    AND NEW.status IN('scanning','preparing','ready','queued','running','validating','paused','failed')
    AND NEW.snapshot#>>'{rulepack,engine}' IS DISTINCT FROM
      (SELECT engine_version FROM liekan_history_repair_campaign WHERE id=NEW.campaign_id) THEN
    RAISE EXCEPTION 'Historical repair worker engine changed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER liekan_repair_engine_fence BEFORE INSERT OR UPDATE ON liekan_history_repair_run
FOR EACH ROW EXECUTE FUNCTION liekan_repair_engine_fence();
