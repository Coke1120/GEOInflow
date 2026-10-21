-- Keep each property eligibility lookup bound to its exact parent event.
-- This prevents fresh statistics from expanding repeated repair policy joins.
SET LOCAL lock_timeout TO '5s';
CREATE OR REPLACE VIEW liekan_effective_event_data AS
SELECT d.* FROM event_data d
WHERE EXISTS (
 SELECT 1 FROM liekan_effective_website_event e
 WHERE e.event_id=d.website_event_id AND e.website_id=d.website_id OFFSET 0
);
