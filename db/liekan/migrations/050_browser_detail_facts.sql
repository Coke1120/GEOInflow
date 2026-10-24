SET LOCAL lock_timeout='2s';
CREATE TABLE liekan_analysis_browser_detail (
 website_id uuid NOT NULL, generation uuid NOT NULL,
 format text NOT NULL, complete boolean NOT NULL DEFAULT false,
 PRIMARY KEY(website_id,generation),
 FOREIGN KEY(website_id,generation) REFERENCES liekan_analysis_generation(website_id,generation)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE liekan_analysis_browser_visit (
 website_id uuid NOT NULL, generation uuid NOT NULL, bucket timestamptz NOT NULL,
 session_id uuid NOT NULL, visit_id uuid NOT NULL,
 pageviews bigint NOT NULL CHECK(pageviews>=0), has_custom boolean NOT NULL,
 first_pv jsonb, last_pv jsonb, entry jsonb,
 browser text, os text, device text, session_created_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,generation,bucket,session_id,visit_id),
 FOREIGN KEY(website_id,generation) REFERENCES liekan_analysis_generation(website_id,generation)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
) PARTITION BY RANGE(bucket);
CREATE TABLE liekan_analysis_browser_path (
 website_id uuid NOT NULL, generation uuid NOT NULL, bucket timestamptz NOT NULL,
 session_id uuid NOT NULL, visit_id uuid NOT NULL,
 path varchar(500) NOT NULL, event_type integer NOT NULL, event_name varchar(50) NOT NULL,
 name_missing boolean NOT NULL, events bigint NOT NULL CHECK(events>=0),
 pageviews bigint NOT NULL CHECK(pageviews>=0), dwell_total double precision NOT NULL,
 dwell_samples bigint NOT NULL CHECK(dwell_samples>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(website_id,generation,bucket,session_id,visit_id,path,event_type,event_name,name_missing),
 FOREIGN KEY(website_id,generation) REFERENCES liekan_analysis_generation(website_id,generation)
  ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
) PARTITION BY RANGE(bucket);
