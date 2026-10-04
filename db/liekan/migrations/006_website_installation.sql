CREATE TABLE liekan_installation (
  website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
  method varchar(20) NOT NULL DEFAULT 'cloudflare' CHECK (method IN ('cloudflare', 'server', 'manual')),
  last_step varchar(10) NOT NULL DEFAULT 'js' CHECK (last_step IN ('js', 'logs', 'finish')),
  browser_check_deferred boolean NOT NULL DEFAULT false,
  log_check_deferred boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
