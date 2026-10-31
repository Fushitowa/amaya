-- Add optional image attachment support to inventory items
ALTER TABLE inventory_items
    ADD COLUMN image_url LONGTEXT NULL AFTER name;
