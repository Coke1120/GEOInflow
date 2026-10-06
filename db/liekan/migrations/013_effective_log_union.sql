-- Read-only eligibility contract for manual and automatic logs.
-- Disjoint branches allow anti/semi joins while preserving interval boundaries.
CREATE OR REPLACE VIEW liekan_effective_log AS
SELECT l.* FROM liekan_log l
WHERE l.source_id IS NULL AND NOT EXISTS (
  SELECT 1 FROM liekan_log_interval i
  WHERE i.website_id=l.website_id
    AND l.created_at>=i.starts_at
    AND (i.ends_at IS NULL OR l.created_at<i.ends_at)
)
UNION ALL
SELECT l.* FROM liekan_log l
WHERE l.source_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM liekan_log_interval i
  WHERE i.website_id=l.website_id AND i.source_id=l.source_id
    AND l.created_at>=i.starts_at
    AND (i.ends_at IS NULL OR l.created_at<i.ends_at)
);
