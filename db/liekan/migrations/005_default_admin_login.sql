-- Apply the Liekan default to the unchanged upstream initial administrator.
-- Preserve customized credentials, identities, roles and deleted accounts.
UPDATE "user"
SET password = '$2b$10$IDjOY4/MnnXCzASHR5sF4e3Yuppkx15tPdf5NPCmxzTLpjjX0Ltz6', updated_at = now()
WHERE user_id = '41e2b680-648e-4b09-bcd7-3e2b10c06264'
  AND username = 'admin'
  AND role = 'admin'
  AND deleted_at IS NULL
  AND password = '$2b$10$BUli0c.muyCW1ErNJc3jL.vFRFtFJWrT8/GcR4A.sUdCznaXiqFXa';
