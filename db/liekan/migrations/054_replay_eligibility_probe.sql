-- Keep replay eligibility tied to its own visit instead of grouping every eligible visit first.
SET LOCAL lock_timeout TO '2s';
CREATE OR REPLACE VIEW liekan_effective_session_replay AS
SELECT r.* FROM session_replay r
WHERE EXISTS (SELECT 1 FROM liekan_effective_website_event e
 WHERE e.website_id=r.website_id AND e.session_id=r.session_id AND e.visit_id=r.visit_id
 OFFSET 0);
