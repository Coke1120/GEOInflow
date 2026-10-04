ALTER TABLE liekan_ai_connection ADD COLUMN workspace_id varchar(100);
ALTER TABLE liekan_ai_connection ADD CONSTRAINT liekan_ai_workspace_provider CHECK (workspace_id IS NULL OR provider='anthropic');
