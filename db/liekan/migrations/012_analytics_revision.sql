CREATE TABLE liekan_analytics_revision (
  resource_type text NOT NULL CHECK (resource_type IN ('website', 'link', 'pixel')),
  resource_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_type, resource_id)
);
-- Keep revision tombstones after resource deletion so delayed computations cannot reuse old keys.
