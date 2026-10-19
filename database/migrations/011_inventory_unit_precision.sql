USE amaya;

-- Keep sub-gram/sub-milliliter conversions accurately when recipe and stock
-- units differ (for example, milligrams recorded against kilograms in stock).
ALTER TABLE inventory_items
    MODIFY COLUMN quantity DECIMAL(16,6) NOT NULL DEFAULT 0.000000,
    MODIFY COLUMN maximum_stock DECIMAL(16,6) NULL DEFAULT NULL;

ALTER TABLE inventory_movements
    MODIFY COLUMN quantity_change DECIMAL(16,6) NOT NULL;

ALTER TABLE product_ingredients
    MODIFY COLUMN quantity_used DECIMAL(16,6) NULL;

ALTER TABLE product_addons
    MODIFY COLUMN quantity_used DECIMAL(16,6) NULL;

ALTER TABLE product_size_ingredients
    MODIFY COLUMN quantity_used DECIMAL(16,6) NOT NULL;

ALTER TABLE order_inventory_consumptions
    MODIFY COLUMN quantity_used DECIMAL(16,6) NOT NULL;
