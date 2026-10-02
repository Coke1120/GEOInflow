ALTER TABLE liekan_catalog ADD COLUMN structure_score integer CHECK (structure_score BETWEEN 0 AND 100);
