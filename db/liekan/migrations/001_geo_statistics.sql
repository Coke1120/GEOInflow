CREATE TABLE liekan_import (
  id uuid PRIMARY KEY,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  digest varchar(64) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  accepted integer NOT NULL,
  rejected integer NOT NULL,
  UNIQUE (website_id, digest)
);
CREATE TABLE liekan_log (
  id varchar(64) NOT NULL,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  import_id uuid NOT NULL REFERENCES liekan_import(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  path varchar(500) NOT NULL,
  method varchar(10) NOT NULL,
  status integer NOT NULL,
  bytes bigint NOT NULL,
  ip_masked varchar(80) NOT NULL,
  ip_hash varchar(64) NOT NULL,
  user_agent varchar(500) NOT NULL,
  location varchar(80) NOT NULL,
  bot varchar(80) NOT NULL,
  vendor varchar(80) NOT NULL,
  bot_type varchar(30) NOT NULL,
  verification varchar(30) NOT NULL,
  PRIMARY KEY (website_id, id)
);
CREATE INDEX liekan_log_date ON liekan_log(website_id, created_at DESC);
CREATE INDEX liekan_log_path ON liekan_log(website_id, path, created_at);
CREATE INDEX liekan_log_bot ON liekan_log(website_id, bot, created_at);
CREATE TABLE liekan_catalog (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  path varchar(500) NOT NULL,
  title varchar(200) NOT NULL,
  content_type varchar(50) NOT NULL,
  word_count integer,
  published_at timestamptz,
  structured boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(website_id, path)
);
CREATE TABLE liekan_setting (
  website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
  robots text NOT NULL DEFAULT '',
  allowlist jsonb NOT NULL DEFAULT '[]',
  rules jsonb NOT NULL DEFAULT '[]',
  is_demo boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
