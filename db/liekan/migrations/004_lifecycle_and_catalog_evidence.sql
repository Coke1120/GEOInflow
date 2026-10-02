ALTER TABLE liekan_import ADD CONSTRAINT liekan_import_website_id_fkey FOREIGN KEY(website_id) REFERENCES website(website_id) ON DELETE CASCADE;
ALTER TABLE liekan_log ADD CONSTRAINT liekan_log_website_id_fkey FOREIGN KEY(website_id) REFERENCES website(website_id) ON DELETE CASCADE;
ALTER TABLE liekan_catalog ADD CONSTRAINT liekan_catalog_website_id_fkey FOREIGN KEY(website_id) REFERENCES website(website_id) ON DELETE CASCADE;
ALTER TABLE liekan_setting ADD CONSTRAINT liekan_setting_website_id_fkey FOREIGN KEY(website_id) REFERENCES website(website_id) ON DELETE CASCADE;
ALTER TABLE liekan_catalog ADD COLUMN content_updated_at timestamptz;
ALTER TABLE liekan_catalog ADD COLUMN link_depth integer CHECK(link_depth>=0);
ALTER TABLE liekan_catalog ADD COLUMN evidence_source varchar(200) NOT NULL DEFAULT '用户上传，来源未核验';
