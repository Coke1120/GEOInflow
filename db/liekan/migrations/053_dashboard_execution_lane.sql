-- Short first attempts have one independent slot; retries retain the heavy analysis budget.
CREATE TABLE liekan_analysis_dashboard_lease (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), token uuid,
 epoch bigint NOT NULL DEFAULT 0, lease_until timestamptz
);
INSERT INTO liekan_analysis_dashboard_lease(id) VALUES(true);
