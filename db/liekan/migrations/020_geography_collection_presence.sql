-- Keep eligible event presence when historical session metadata is missing.
CREATE OR REPLACE VIEW liekan_geographic_website_event AS
SELECT e.*, CASE WHEN g.event_id IS NOT NULL THEN g.country ELSE s.country END AS liekan_country,
  CASE WHEN g.event_id IS NOT NULL THEN g.region ELSE s.region END AS liekan_region,
  CASE WHEN g.event_id IS NOT NULL THEN g.city ELSE s.city END AS liekan_city
FROM liekan_effective_website_event e
LEFT JOIN session s ON s.session_id=e.session_id AND s.website_id=e.website_id
LEFT JOIN LATERAL (
  SELECT a.event_id FROM liekan_effective_website_event a
  WHERE a.website_id=e.website_id AND a.session_id=e.session_id AND a.visit_id=e.visit_id
    AND a.event_type NOT IN(2,5)
  ORDER BY a.created_at,a.event_id LIMIT 1
) anchor ON true
LEFT JOIN liekan_event_geography g ON g.website_id=e.website_id AND g.event_id=anchor.event_id;
