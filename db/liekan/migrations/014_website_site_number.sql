-- Short public site numbers for URLs, assigned from 101. The website UUID stays the primary key
-- and the only tracker identifier, while site_number is a display/navigation handle only.
CREATE SEQUENCE liekan_website_site_number_seq START 101;
ALTER TABLE website ADD COLUMN site_number integer;
UPDATE website
  SET site_number = ordered.site_number
  FROM (
    SELECT website_id,
           (row_number() OVER (ORDER BY created_at NULLS LAST, website_id))::integer + 100 AS site_number
    FROM website
  ) AS ordered
  WHERE website.website_id = ordered.website_id;
SELECT setval('liekan_website_site_number_seq', (SELECT COALESCE(MAX(site_number), 100) FROM website));
ALTER TABLE website ALTER COLUMN site_number SET DEFAULT nextval('liekan_website_site_number_seq');
CREATE UNIQUE INDEX website_site_number_key ON website(site_number);
ALTER SEQUENCE liekan_website_site_number_seq OWNED BY website.site_number;
