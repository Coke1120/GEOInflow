CREATE TABLE liekan_ai_audit (
 id uuid PRIMARY KEY,
 actor_id uuid REFERENCES "user"(user_id) ON DELETE SET NULL,
 owner_user_id uuid REFERENCES "user"(user_id) ON DELETE CASCADE,
 team_id uuid REFERENCES team(team_id) ON DELETE CASCADE,
 connection_id uuid NOT NULL,
 action varchar(20) NOT NULL CHECK (action IN ('create','update','delete','default')),
 config_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '180 days',
 CHECK ((owner_user_id IS NOT NULL)::integer+(team_id IS NOT NULL)::integer=1)
);
CREATE INDEX liekan_ai_audit_user ON liekan_ai_audit(owner_user_id,created_at);
CREATE INDEX liekan_ai_audit_team ON liekan_ai_audit(team_id,created_at);
CREATE INDEX liekan_ai_audit_expiry ON liekan_ai_audit(expires_at);
