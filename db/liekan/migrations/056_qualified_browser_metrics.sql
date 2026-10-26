-- Keep observed collection coverage separate from the population used by every browser metric.
SET LOCAL lock_timeout TO '5s';

CREATE VIEW liekan_browser_identity AS
SELECT env.* FROM liekan_event_environment env
JOIN liekan_reporting_event_quality q ON q.website_id=env.website_id AND q.event_id=env.event_id
WHERE env.scope='browser' AND env.identity_available
  AND q.source='browser' AND q.classification='browser';

CREATE VIEW liekan_observed_browser_event AS
SELECT e.* FROM liekan_admissible_browser_event e
WHERE NOT EXISTS (
  SELECT 1 FROM liekan_traffic_exclusion_member m
  JOIN liekan_traffic_exclusion x ON x.id=m.collection_id AND x.website_id=m.website_id
  LEFT JOIN liekan_log_state ls ON ls.website_id=x.website_id
  WHERE m.website_id=e.website_id AND m.event_id=e.event_id
    AND x.state='active' AND x.epoch=coalesce(ls.epoch,1)
);

CREATE OR REPLACE VIEW liekan_effective_browser_event AS
SELECT e.* FROM liekan_observed_browser_event e
JOIN liekan_browser_identity identity ON identity.website_id=e.website_id AND identity.event_id=e.event_id;

CREATE VIEW liekan_observed_website_event AS
SELECT * FROM liekan_observed_browser_event
UNION ALL SELECT * FROM liekan_effective_link_event
UNION ALL SELECT * FROM liekan_effective_pixel_event;

-- Old persisted results used a broader PV population and must be recomputed.
INSERT INTO liekan_analytics_revision(resource_type,resource_id,revision)
SELECT 'website',website_id,1 FROM website
ON CONFLICT(resource_type,resource_id) DO UPDATE
SET revision=liekan_analytics_revision.revision+1,updated_at=clock_timestamp();
