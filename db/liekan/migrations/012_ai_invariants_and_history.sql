ALTER TABLE liekan_ai_connection ADD CONSTRAINT liekan_ai_default_verified CHECK (
  NOT is_default OR (enabled AND secret_envelope IS NOT NULL AND verified_config_version IS NOT NULL AND verified_config_version=config_version AND test_state='connected')
);
CREATE INDEX liekan_ai_run_connection_history ON liekan_ai_run(connection_id,created_at DESC,id DESC) WHERE connection_id IS NOT NULL;
