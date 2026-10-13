CREATE TABLE liekan_collection_policy (
  website_id uuid PRIMARY KEY REFERENCES website(website_id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard','strict','raw')),
  allowed_hostnames text[] NOT NULL DEFAULT '{}',
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE liekan_collection_hostname (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  reported_hash text NOT NULL,
  hostname text,
  PRIMARY KEY(website_id,reported_hash)
);
CREATE INDEX liekan_collection_hostname_input ON website_event(website_id,hostname);

CREATE TABLE liekan_collection_receipt (
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  client_event_id uuid NOT NULL,
  payload_hash text NOT NULL,
  event_id uuid REFERENCES website_event(event_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (website_id,client_event_id)
);

CREATE TABLE liekan_event_quality (
  event_id uuid PRIMARY KEY REFERENCES website_event(event_id) ON DELETE CASCADE,
  website_id uuid NOT NULL REFERENCES website(website_id) ON DELETE CASCADE,
  classification text NOT NULL CHECK (classification IN ('browser','automated','suspected','unknown')),
  source text NOT NULL CHECK (source IN ('browser','authenticated_server','legacy_override')),
  reasons text[] NOT NULL,
  rule_version text NOT NULL,
  range_version text,
  range_status text NOT NULL CHECK (range_status IN ('fresh','stale','missing','untrusted','invalid')),
  hostname text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX liekan_event_quality_site_class ON liekan_event_quality(website_id,classification,created_at);

-- Missing historical verdicts stay eligible and are reported as unknown.
-- Policy changes affect reads while original events and collection evidence remain intact.
CREATE VIEW liekan_raw_website_event AS SELECT * FROM website_event;

CREATE VIEW liekan_effective_website_event AS
SELECT e.* FROM website_event e
LEFT JOIN liekan_event_quality q ON q.event_id=e.event_id AND q.website_id=e.website_id
LEFT JOIN liekan_collection_policy p ON p.website_id=e.website_id
LEFT JOIN liekan_collection_hostname h ON h.website_id=e.website_id
 AND q.hostname IS NULL AND cardinality(p.allowed_hostnames)>0
 AND h.reported_hash=encode(sha256(convert_to(e.hostname,'UTF8')),'hex')
WHERE COALESCE(p.mode,'standard')='raw'
   OR (
     COALESCE(q.classification,'unknown') <> 'automated'
     AND (COALESCE(p.mode,'standard') <> 'strict' OR COALESCE(q.classification,'unknown') <> 'suspected')
     AND (
       COALESCE(cardinality(p.allowed_hostnames),0)=0
       OR COALESCE(q.hostname,h.hostname)=ANY(p.allowed_hostnames)
     )
   );

CREATE VIEW liekan_effective_event_data AS
SELECT d.* FROM event_data d
WHERE EXISTS (SELECT 1 FROM liekan_effective_website_event e WHERE e.event_id=d.website_event_id AND e.website_id=d.website_id);

CREATE VIEW liekan_effective_revenue AS
SELECT r.* FROM revenue r
WHERE EXISTS (SELECT 1 FROM liekan_effective_website_event e WHERE e.event_id=r.event_id AND e.website_id=r.website_id);

-- Recording signals with no linked visit retain their historical unknown state.
CREATE VIEW liekan_effective_heatmap_event AS
SELECT h.* FROM heatmap_event h
WHERE NOT EXISTS (SELECT 1 FROM website_event e WHERE e.website_id=h.website_id AND e.session_id=h.session_id AND e.visit_id=h.visit_id)
   OR EXISTS (SELECT 1 FROM liekan_effective_website_event e WHERE e.website_id=h.website_id AND e.session_id=h.session_id AND e.visit_id=h.visit_id);

CREATE VIEW liekan_effective_session_replay AS
SELECT r.* FROM session_replay r
WHERE NOT EXISTS (SELECT 1 FROM website_event e WHERE e.website_id=r.website_id AND e.session_id=r.session_id AND e.visit_id=r.visit_id)
   OR EXISTS (SELECT 1 FROM liekan_effective_website_event e WHERE e.website_id=r.website_id AND e.session_id=r.session_id AND e.visit_id=r.visit_id);
