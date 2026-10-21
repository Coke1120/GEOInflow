-- Preserve signed-identity settings with each immutable classification revision.
SET LOCAL lock_timeout TO '5s';
ALTER TABLE liekan_crawler_rule_version ADD COLUMN crawler_configuration jsonb;
