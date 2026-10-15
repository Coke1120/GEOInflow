-- Preserve explicit legacy choices while allowing untouched defaults to receive catalog updates.
ALTER TABLE liekan_setting ALTER COLUMN rules DROP NOT NULL;
ALTER TABLE liekan_setting ALTER COLUMN rules SET DEFAULT NULL;
ALTER TABLE liekan_setting ADD COLUMN crawler_rules jsonb;
ALTER TABLE liekan_setting ADD COLUMN rules_revision integer NOT NULL DEFAULT 0;
ALTER TABLE liekan_setting ADD COLUMN rules_migration_snapshot jsonb;
UPDATE liekan_setting SET rules_migration_snapshot=jsonb_build_object('rules',rules),
  crawler_rules=CASE
    WHEN rules IS NULL OR rules='[
      {"name":"GPTBot","vendor":"OpenAI","type":"训练","pattern":"GPTBot"},
      {"name":"OAI-SearchBot","vendor":"OpenAI","type":"搜索","pattern":"OAI-SearchBot"},
      {"name":"ChatGPT-User","vendor":"OpenAI","type":"用户触发","pattern":"ChatGPT-User"},
      {"name":"ClaudeBot","vendor":"Anthropic","type":"训练","pattern":"ClaudeBot"},
      {"name":"Claude-SearchBot","vendor":"Anthropic","type":"搜索","pattern":"Claude-SearchBot"},
      {"name":"Claude-User","vendor":"Anthropic","type":"用户触发","pattern":"Claude-User"},
      {"name":"PerplexityBot","vendor":"Perplexity","type":"搜索","pattern":"PerplexityBot"},
      {"name":"Perplexity-User","vendor":"Perplexity","type":"用户触发","pattern":"Perplexity-User"},
      {"name":"Bytespider","vendor":"字节跳动","type":"训练","pattern":"Bytespider"},
      {"name":"Googlebot","vendor":"Google","type":"传统搜索","pattern":"Googlebot"},
      {"name":"Baiduspider","vendor":"百度","type":"传统搜索","pattern":"Baiduspider"},
      {"name":"bingbot","vendor":"Microsoft","type":"传统搜索","pattern":"bingbot"},
      {"name":"Applebot","vendor":"Apple","type":"传统搜索","pattern":"Applebot"}
    ]'::jsonb THEN '{"mode":"official","disabledIds":[],"overrides":{},"customRules":[]}'::jsonb
    WHEN rules='[]'::jsonb THEN '{"mode":"disabled"}'::jsonb
    ELSE jsonb_build_object('mode','legacy','rules',rules)
  END;

CREATE TABLE liekan_crawler_rule_version (
  website_id uuid NOT NULL,
  version text NOT NULL,
  matcher_version text NOT NULL,
  rules jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(website_id,version)
);

-- Nullable additions retain the meaning of historical records and queued old payloads.
ALTER TABLE liekan_log ADD COLUMN ai_eligible boolean;
ALTER TABLE liekan_log ADD COLUMN recognition_state text;
ALTER TABLE liekan_log ADD COLUMN recognition_candidates jsonb;
ALTER TABLE liekan_log ADD COLUMN verification_observed_at timestamptz;
ALTER TABLE liekan_log ADD COLUMN verification_reason text;

CREATE OR REPLACE VIEW liekan_effective_log AS
SELECT l.* FROM liekan_log l
WHERE l.source_id IS NULL AND NOT EXISTS (
  SELECT 1 FROM liekan_log_interval i
  WHERE i.website_id=l.website_id AND l.created_at>=i.starts_at
    AND (i.ends_at IS NULL OR l.created_at<i.ends_at)
)
UNION ALL
SELECT l.* FROM liekan_log l
WHERE l.source_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM liekan_log_interval i
  WHERE i.website_id=l.website_id AND i.source_id=l.source_id AND l.created_at>=i.starts_at
    AND (i.ends_at IS NULL OR l.created_at<i.ends_at)
);
