-- Register the installed population without rewriting retained analytics.
SET LOCAL lock_timeout TO '5s';
CREATE TABLE liekan_history_repair_campaign (
  id text PRIMARY KEY,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  eligible_websites uuid[] NOT NULL,
  engine_version text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK(state IN('active','closed')),
  lease_token uuid,
  lease_until timestamptz,
  lease_run_id uuid
);
INSERT INTO liekan_history_repair_campaign(id,eligible_websites,engine_version)
SELECT 'traffic-quality-repair-20261022-v1',coalesce(array_agg(w.website_id),'{}'::uuid[]),'history-repair-v1.1'
FROM website w LEFT JOIN liekan_setting s USING(website_id)
WHERE w.deleted_at IS NULL AND NOT coalesce(s.is_demo,false);

CREATE TABLE liekan_history_repair_run (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  campaign_id text NOT NULL REFERENCES liekan_history_repair_campaign(id),
  actor_id uuid NOT NULL,
  status text NOT NULL CHECK(status IN('unscanned','scanning','preparing','ready','queued','running','validating','completed','completed_limited','unchanged','unidentifiable','empty','paused','failed','cancelled','rolled_back','expired','invalidated')),
  phase text NOT NULL DEFAULT 'boundary',
  revision integer NOT NULL DEFAULT 1,
  input_revision integer NOT NULL DEFAULT 0,
  generation uuid NOT NULL,
  active_generation uuid,
  previous_generation uuid,
  active_revision integer NOT NULL DEFAULT 0,
  frozen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  repair_scope_id uuid NOT NULL,
  scope_finalized boolean NOT NULL DEFAULT false,
  scope_changed boolean NOT NULL DEFAULT false,
  scope_revision bigint NOT NULL DEFAULT 0,
  membership_digest varchar(64),
  excluded_batches uuid[] NOT NULL DEFAULT '{}',
  snapshot jsonb NOT NULL,
  cursor jsonb NOT NULL DEFAULT '{}',
  counts jsonb NOT NULL DEFAULT '{}',
  log_impact jsonb NOT NULL DEFAULT '{}',
  preview jsonb,
  generation_archive jsonb NOT NULL DEFAULT '{}',
  approved_digest varchar(64),
  confirmed_at timestamptz,
  partial_confirmed boolean NOT NULL DEFAULT false,
  lease_token uuid,
  lease_until timestamptz,
  queued_job_id uuid,
  batch_size integer NOT NULL DEFAULT 2000 CHECK(batch_size BETWEEN 100 AND 2000),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  locale text NOT NULL CHECK(locale IN('zh-CN','en-US')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(website_id,campaign_id)
);
CREATE INDEX liekan_history_repair_pending ON liekan_history_repair_run(next_attempt_at,updated_at)
WHERE status IN('scanning','preparing','queued','running','validating');
CREATE TABLE liekan_history_repair_result (
  run_id uuid NOT NULL REFERENCES liekan_history_repair_run(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  generation uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN('event','log')),
  record_id text NOT NULL,
  before_value jsonb NOT NULL,
  after_value jsonb NOT NULL,
  proof jsonb NOT NULL,
  issue text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,generation,kind,record_id)
);
CREATE INDEX liekan_history_repair_active_result ON liekan_history_repair_result(website_id,generation,kind,record_id);
CREATE TABLE liekan_history_repair_day (
  run_id uuid NOT NULL REFERENCES liekan_history_repair_run(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  generation uuid NOT NULL,
  day date NOT NULL,
  before_pv bigint NOT NULL DEFAULT 0,
  after_pv bigint NOT NULL DEFAULT 0,
  before_uv bigint NOT NULL DEFAULT 0,
  after_uv bigint NOT NULL DEFAULT 0,
  event_rows bigint NOT NULL DEFAULT 0,
  log_rows bigint NOT NULL DEFAULT 0,
  changed_events bigint NOT NULL DEFAULT 0,
  changed_logs bigint NOT NULL DEFAULT 0,
  evidence_rows bigint NOT NULL DEFAULT 0,
  log_evidence_rows bigint NOT NULL DEFAULT 0,
  coverage text NOT NULL DEFAULT 'missing' CHECK(coverage IN('complete','partial','missing')),
  PRIMARY KEY(run_id,generation,day)
);
CREATE TABLE liekan_history_repair_visitor (
  run_id uuid NOT NULL REFERENCES liekan_history_repair_run(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  generation uuid NOT NULL,
  scope_day text NOT NULL,
  item_key text NOT NULL DEFAULT '',
  session_id uuid NOT NULL,
  before_included boolean NOT NULL,
  after_included boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,generation,scope_day,session_id,item_key)
);
CREATE TABLE liekan_history_repair_input (
  run_id uuid NOT NULL REFERENCES liekan_history_repair_run(id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  upload_id uuid NOT NULL,
  generation uuid NOT NULL,
  sequence integer NOT NULL CHECK(sequence>=0),
  chunk_hash varchar(64) NOT NULL,
  rulepack_hash varchar(64) NOT NULL,
  source text NOT NULL,
  actor_id uuid NOT NULL,
  rows integer NOT NULL,
  accepted integer NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]',
  records jsonb NOT NULL DEFAULT '[]',
  state text NOT NULL DEFAULT 'open' CHECK(state IN('open','finalized','discarded')),
  manifest_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,upload_id,sequence)
);
CREATE INDEX liekan_history_repair_input_records ON liekan_history_repair_input USING gin(records jsonb_path_ops);
CREATE TABLE liekan_history_repair_action (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  run_id uuid REFERENCES liekan_history_repair_run(id) ON DELETE CASCADE,
  actor_id uuid,
  generation uuid,
  action text NOT NULL,
  payload_hash varchar(64) NOT NULL,
  response jsonb NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX liekan_history_repair_audit ON liekan_history_repair_action(website_id,created_at DESC,id);
CREATE INDEX liekan_history_repair_scope_gap ON liekan_history_repair_action(run_id,generation) WHERE action='scope-gap';
CREATE TABLE liekan_history_repair_notice (
  user_id uuid NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  campaign_id text NOT NULL REFERENCES liekan_history_repair_campaign(id),
  dismissed_at timestamptz,
  read_at timestamptz,
  PRIMARY KEY(user_id,campaign_id)
);

-- A rolling deployment writes NULL until the new receiver reads the frozen boundary.
ALTER TABLE liekan_event_quality ADD COLUMN repair_scope_id uuid;
ALTER TABLE liekan_import ADD COLUMN repair_scope_id uuid;
ALTER TABLE liekan_ingest_batch ADD COLUMN repair_scope_id uuid;
CREATE INDEX liekan_history_quality_scope ON liekan_event_quality(website_id,event_id) WHERE repair_scope_id IS NULL;
CREATE INDEX liekan_history_import_scope ON liekan_import(website_id,id) WHERE repair_scope_id IS NULL;
CREATE INDEX liekan_history_batch_scope ON liekan_ingest_batch(website_id,state) WHERE repair_scope_id IS NULL;

-- Preserve intake on an older receiver while making its changed boundary visible.
CREATE FUNCTION liekan_history_repair_mark_gap(run_id uuid,site_id uuid,generation_id uuid,origin text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE changed integer;
BEGIN
  UPDATE liekan_history_repair_run SET scope_changed=true,scope_revision=scope_revision+1,
    error_code=CASE WHEN active_generation IS NOT NULL THEN 'active-scope-gap' ELSE 'scope-changed' END,
    updated_at=clock_timestamp() WHERE id=(SELECT id FROM liekan_history_repair_run
      WHERE id=run_id FOR NO KEY UPDATE SKIP LOCKED);
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed=0 THEN
    INSERT INTO liekan_history_repair_action(id,website_id,run_id,generation,action,payload_hash,response,details)
    VALUES(gen_random_uuid(),site_id,run_id,generation_id,'scope-gap',
      encode(sha256(convert_to('scope-gap:'||origin||run_id::text||gen_random_uuid()::text,'UTF8')),'hex'),
      '{"scopeChanged":true}'::jsonb,jsonb_build_object('origin',origin));
  END IF;
END $fn$;
CREATE FUNCTION liekan_history_repair_boundary() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE repair liekan_history_repair_run%ROWTYPE;
BEGIN
  IF NEW.repair_scope_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO repair FROM liekan_history_repair_run WHERE website_id=NEW.website_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='liekan_import' THEN
    IF NOT repair.scope_finalized AND EXISTS(SELECT 1 FROM liekan_ingest_batch b WHERE b.id=NEW.id
       AND b.website_id=NEW.website_id AND b.repair_scope_id IS NULL AND b.received_at<=repair.frozen_at)
    THEN RETURN NEW; END IF;
  END IF;
  PERFORM liekan_history_repair_mark_gap(repair.id,NEW.website_id,repair.generation,TG_TABLE_NAME);
  RETURN NEW;
END $fn$;
CREATE TRIGGER liekan_history_quality_boundary AFTER INSERT ON liekan_event_quality FOR EACH ROW EXECUTE FUNCTION liekan_history_repair_boundary();
CREATE TRIGGER liekan_history_import_boundary AFTER INSERT ON liekan_import FOR EACH ROW EXECUTE FUNCTION liekan_history_repair_boundary();
CREATE TRIGGER liekan_history_batch_boundary AFTER INSERT ON liekan_ingest_batch FOR EACH ROW EXECUTE FUNCTION liekan_history_repair_boundary();

CREATE FUNCTION liekan_history_repair_removed() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE repair liekan_history_repair_run%ROWTYPE;
BEGIN
  IF OLD.repair_scope_id IS NULL THEN
    SELECT * INTO repair FROM liekan_history_repair_run WHERE website_id=OLD.website_id;
    IF FOUND THEN PERFORM liekan_history_repair_mark_gap(repair.id,OLD.website_id,repair.generation,TG_TABLE_NAME); END IF;
  END IF;
  RETURN OLD;
END $fn$;
CREATE TRIGGER liekan_history_quality_removed AFTER DELETE ON liekan_event_quality FOR EACH ROW EXECUTE FUNCTION liekan_history_repair_removed();
CREATE TRIGGER liekan_history_import_removed AFTER DELETE ON liekan_import FOR EACH ROW EXECUTE FUNCTION liekan_history_repair_removed();

CREATE VIEW liekan_reporting_event_quality AS
SELECT q.event_id,q.website_id,
  coalesce(r.after_value->>'classification',q.classification) AS classification,
  q.source,
  CASE WHEN r.record_id IS NULL THEN q.reasons ELSE ARRAY(SELECT jsonb_array_elements_text(r.after_value->'reasons')) END AS reasons,
  coalesce(r.after_value->>'ruleVersion',q.rule_version) AS rule_version,
  q.range_version,q.range_status,q.hostname,q.created_at,q.catalog_version,q.repair_scope_id
FROM liekan_event_quality q
LEFT JOIN liekan_history_repair_run run ON run.website_id=q.website_id
LEFT JOIN liekan_history_repair_result r ON r.run_id=run.id AND r.generation=run.active_generation
 AND r.kind='event' AND r.record_id=q.event_id::text AND r.issue IS NULL
WHERE true;

CREATE OR REPLACE VIEW liekan_effective_website_event AS
SELECT e.* FROM website_event e
LEFT JOIN liekan_reporting_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
LEFT JOIN liekan_collection_policy p ON p.website_id=e.website_id
LEFT JOIN liekan_collection_hostname h ON h.website_id=e.website_id
 AND q.hostname IS NULL AND cardinality(p.allowed_hostnames)>0
 AND h.reported_hash=encode(sha256(convert_to(e.hostname,'UTF8')),'hex')
WHERE (q.source='browser' OR e.event_type IN(3,4)) AND (
 coalesce(p.mode,'standard')='raw' OR (
  coalesce(q.classification,'unknown')<>'automated'
  AND (coalesce(p.mode,'standard')<>'strict' OR coalesce(q.classification,'unknown')<>'suspected')
  AND (coalesce(cardinality(p.allowed_hostnames),0)=0 OR coalesce(q.hostname,h.hostname)=ANY(p.allowed_hostnames))
 ));

-- Ownership and source intervals are resolved by the original view before the overlay.
-- The raw log and its archived proof remain the authority for GEO and risk workflows.
CREATE VIEW liekan_reporting_log AS
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
LEFT JOIN liekan_history_repair_result r ON r.run_id=run.id AND r.generation=run.active_generation
 AND r.kind='log' AND r.record_id=l.id;
