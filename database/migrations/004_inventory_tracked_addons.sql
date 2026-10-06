-- Link menu add-ons to inventory so selected add-ons consume stock as well.
USE amaya;

ALTER TABLE product_addons
    ADD COLUMN inventory_item_id BIGINT UNSIGNED NULL AFTER price,
    ADD COLUMN quantity_used DECIMAL(12,3) NULL AFTER inventory_item_id,
    ADD KEY idx_product_addons_inventory_item (inventory_item_id),
    ADD CONSTRAINT fk_product_addons_inventory_item
        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
        ON UPDATE CASCADE ON DELETE RESTRICT;
