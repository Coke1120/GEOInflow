-- Recovery cursors keep acknowledged business batches independent of queue retry retention.
ALTER TABLE liekan_ingest_batch ADD COLUMN last_recovery_at timestamptz;
CREATE INDEX liekan_ingest_recovery ON liekan_ingest_batch(last_recovery_at,received_at) WHERE state='pending';
