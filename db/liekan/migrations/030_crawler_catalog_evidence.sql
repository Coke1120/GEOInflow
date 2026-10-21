-- Record the exact catalog used at intake. Historical rows remain explicitly unversioned.
ALTER TABLE liekan_event_quality ADD COLUMN IF NOT EXISTS catalog_version uuid;
ALTER TABLE liekan_crawler_rule_version ADD COLUMN IF NOT EXISTS catalog_version uuid;
ALTER TABLE liekan_crawler_evidence ADD COLUMN IF NOT EXISTS catalog_version uuid;
ALTER TABLE liekan_ingest_batch ADD COLUMN IF NOT EXISTS catalog_version uuid;
