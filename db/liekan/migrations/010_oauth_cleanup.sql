-- Retain issued credentials independently of browser grants and website lifecycle changes.
CREATE TABLE liekan_oauth_cleanup (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL,
  payload text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  lease uuid,
  lease_until timestamptz
);
CREATE INDEX liekan_oauth_cleanup_due ON liekan_oauth_cleanup(expires_at,last_attempt_at);
CREATE INDEX liekan_oauth_cleanup_website ON liekan_oauth_cleanup(website_id);
INSERT INTO liekan_oauth_cleanup(id,website_id,payload,expires_at)
SELECT id,website_id,payload,expires_at FROM liekan_log_grant
WHERE kind='oauth' AND payload IS NOT NULL;
DROP INDEX liekan_log_source_permission_check;
CREATE INDEX liekan_log_source_permission_check ON liekan_log_source(last_permission_check_at)
WHERE credential_hash IS NOT NULL AND state!='disconnected';
