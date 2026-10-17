SET LOCAL lock_timeout TO '5s';
ALTER TABLE liekan_crawler_finding ADD COLUMN occurrence_version integer NOT NULL DEFAULT 1;
ALTER TABLE liekan_crawler_finding ADD COLUMN resolved_window_end timestamptz;
UPDATE liekan_crawler_finding SET resolved_window_end=window_end WHERE state='resolved';
CREATE TABLE liekan_crawler_finding_workflow (
  website_id uuid NOT NULL,
  finding_key varchar(128) NOT NULL,
  workflow_revision integer NOT NULL DEFAULT 0,
  occurrence_version integer NOT NULL,
  epoch integer NOT NULL,
  classification_version text,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','viewed','snoozed')),
  snoozed_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(website_id,finding_key),
  FOREIGN KEY(website_id,finding_key) REFERENCES liekan_crawler_finding(website_id,key) ON DELETE CASCADE
);
CREATE TABLE liekan_crawler_context (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  note varchar(1000) NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  voided_at timestamptz,
  voided_by uuid,
  void_reason varchar(1000)
);
CREATE INDEX liekan_crawler_context_time ON liekan_crawler_context(website_id,occurred_at);
CREATE TABLE liekan_crawler_finding_action (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  finding_key varchar(128),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  note varchar(1000),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  before_state jsonb,
  after_state jsonb NOT NULL,
  PRIMARY KEY(website_id,request_id)
);
CREATE INDEX liekan_finding_action_time ON liekan_crawler_finding_action(website_id,finding_key,occurred_at);

-- Keep occurrence semantics intact when an older worker runs against the additive schema.
CREATE FUNCTION liekan_finding_occurrence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='resolved' THEN
    NEW.resolved_window_end=greatest(OLD.resolved_window_end,NEW.window_end);
  ELSIF OLD.state='resolved' AND NEW.state='active' AND NEW.window_end>coalesce(OLD.resolved_window_end,OLD.window_end) THEN
    NEW.occurrence_version=OLD.occurrence_version+1;
  ELSE
    NEW.occurrence_version=OLD.occurrence_version;
  END IF;
  IF NEW.state<>'active' OR OLD.state='resolved' OR NEW.occurrence_version<>OLD.occurrence_version
     OR (CASE NEW.grade WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)>(CASE OLD.grade WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
     OR NEW.facts->'lastQuality'->>'classificationVersion' IS DISTINCT FROM OLD.facts->'lastQuality'->>'classificationVersion' THEN
    UPDATE liekan_crawler_finding_workflow SET state='pending',snoozed_until=NULL,workflow_revision=workflow_revision+1,updated_at=now()
      WHERE website_id=NEW.website_id AND finding_key=NEW.key AND (state<>'pending' OR snoozed_until IS NOT NULL);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER liekan_finding_occurrence BEFORE UPDATE ON liekan_crawler_finding FOR EACH ROW EXECUTE FUNCTION liekan_finding_occurrence();
