SET LOCAL lock_timeout TO '5s';
ALTER TABLE liekan_crawler_evidence ADD COLUMN identity_evidence jsonb;
