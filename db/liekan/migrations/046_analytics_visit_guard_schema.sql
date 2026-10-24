-- CREATE OR REPLACE clears omitted function SET options. Bind the replaced trigger boundaries.
SET LOCAL lock_timeout TO '2s';
DO $$
BEGIN
 EXECUTE format('ALTER FUNCTION liekan_analysis_visit_evidence_capture() SET search_path TO %I,pg_temp',current_schema());
 EXECUTE format('ALTER FUNCTION liekan_analysis_truncate_capture() SET search_path TO %I,pg_temp',current_schema());
END $$;
