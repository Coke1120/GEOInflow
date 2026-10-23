-- Keep revenue eligibility correlated to its own resource and event before view expansion.
SET LOCAL lock_timeout TO '5s';
CREATE OR REPLACE VIEW liekan_effective_revenue AS
SELECT r.* FROM revenue r
WHERE EXISTS (
 SELECT 1 FROM liekan_effective_website_event e
 WHERE e.event_id=r.event_id AND e.website_id=r.website_id
 OFFSET 0
);
