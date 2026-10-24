-- Durable discovery rotation is independent of execution service and lifecycle retention clocks.
SET LOCAL lock_timeout TO '2s';
ALTER TABLE liekan_analysis_site ADD COLUMN discovery_checked_at timestamptz,
 ADD COLUMN discovery_cursors jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD CONSTRAINT liekan_analysis_discovery_cursors CHECK(jsonb_typeof(discovery_cursors)='object' AND discovery_cursors-ARRAY['finite-log','finite-visit','stale-log','stale-visit','hour-log']='{}'::jsonb
 AND (NOT(discovery_cursors ? 'finite-log') OR (jsonb_typeof(discovery_cursors->'finite-log')='string' AND (discovery_cursors->>'finite-log') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND isfinite((discovery_cursors->>'finite-log')::timestamptz)))
 AND (NOT(discovery_cursors ? 'finite-visit') OR (jsonb_typeof(discovery_cursors->'finite-visit')='string' AND (discovery_cursors->>'finite-visit') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND isfinite((discovery_cursors->>'finite-visit')::timestamptz)))
 AND (NOT(discovery_cursors ? 'stale-log') OR (jsonb_typeof(discovery_cursors->'stale-log')='string' AND (discovery_cursors->>'stale-log') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND isfinite((discovery_cursors->>'stale-log')::timestamptz)))
 AND (NOT(discovery_cursors ? 'stale-visit') OR (jsonb_typeof(discovery_cursors->'stale-visit')='string' AND (discovery_cursors->>'stale-visit') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND isfinite((discovery_cursors->>'stale-visit')::timestamptz)))
 AND (NOT(discovery_cursors ? 'hour-log') OR (jsonb_typeof(discovery_cursors->'hour-log')='string' AND (discovery_cursors->>'hour-log') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' AND isfinite((discovery_cursors->>'hour-log')::timestamptz))));
CREATE INDEX liekan_analysis_discovery_order ON liekan_analysis_site(discovery_checked_at NULLS FIRST,website_id) WHERE mode='live';
CREATE FUNCTION liekan_analysis_discovery_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.discovery_checked_at:=NULL;
 NEW.discovery_cursors:='{}'::jsonb;
 RETURN NEW;
END $$;
CREATE TRIGGER liekan_analysis_discovery_epoch BEFORE UPDATE OF epoch ON liekan_analysis_site
 FOR EACH ROW WHEN(OLD.epoch IS DISTINCT FROM NEW.epoch) EXECUTE FUNCTION liekan_analysis_discovery_epoch();
