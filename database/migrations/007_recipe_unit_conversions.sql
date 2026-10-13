USE amaya;

ALTER TABLE product_addons
    ADD COLUMN usage_unit VARCHAR(40) NULL AFTER quantity_used;

UPDATE product_addons pa
JOIN inventory_items i ON i.id = pa.inventory_item_id
   SET pa.usage_unit = i.unit
 WHERE pa.usage_unit IS NULL;

UPDATE product_addons
   SET usage_unit = 'pcs'
 WHERE usage_unit IS NULL;

ALTER TABLE product_addons
    MODIFY COLUMN usage_unit VARCHAR(40) NOT NULL DEFAULT 'pcs';
