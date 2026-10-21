-- Browser analytics always require collection-source evidence, including raw mode.
-- Link and pixel events retain their independent upstream collection semantics.
CREATE OR REPLACE VIEW liekan_effective_website_event AS
SELECT e.* FROM website_event e
LEFT JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
LEFT JOIN liekan_collection_policy p ON p.website_id=e.website_id
LEFT JOIN liekan_collection_hostname h ON h.website_id=e.website_id
 AND q.hostname IS NULL AND cardinality(p.allowed_hostnames)>0
 AND h.reported_hash=encode(sha256(convert_to(e.hostname,'UTF8')),'hex')
WHERE (q.source='browser' OR e.event_type IN (3,4))
 AND (
   COALESCE(p.mode,'standard')='raw'
   OR (
     COALESCE(q.classification,'unknown') <> 'automated'
     AND (COALESCE(p.mode,'standard') <> 'strict' OR COALESCE(q.classification,'unknown') <> 'suspected')
     AND (
       COALESCE(cardinality(p.allowed_hostnames),0)=0
       OR COALESCE(q.hostname,h.hostname)=ANY(p.allowed_hostnames)
     )
   )
 );

CREATE OR REPLACE VIEW liekan_effective_heatmap_event AS
SELECT h.* FROM heatmap_event h
WHERE EXISTS (SELECT 1 FROM liekan_effective_website_event e
 WHERE e.website_id=h.website_id AND e.session_id=h.session_id AND e.visit_id=h.visit_id);

CREATE OR REPLACE VIEW liekan_effective_session_replay AS
SELECT r.* FROM session_replay r
WHERE EXISTS (SELECT 1 FROM liekan_effective_website_event e
 WHERE e.website_id=r.website_id AND e.session_id=r.session_id AND e.visit_id=r.visit_id);
