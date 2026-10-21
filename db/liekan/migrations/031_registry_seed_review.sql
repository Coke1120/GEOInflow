SET LOCAL lock_timeout TO '5s';
ALTER TABLE liekan_crawler_registry_draft ADD COLUMN seed_payload jsonb CHECK (seed_payload IS NULL OR jsonb_typeof(seed_payload) = 'object');
