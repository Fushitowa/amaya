USE amaya;

-- Dedicated table for items in the "Cups" inventory category.
-- inventory_items stays the source of truth for stock/cost; this adds cup-specific details.
CREATE TABLE IF NOT EXISTS inventory_cups (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    cup_size_oz DECIMAL(5,1) NULL,
    material VARCHAR(60) NULL,
    lid_diameter_mm INT NULL,
    capacity_ml DECIMAL(8,2) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_cups_item (inventory_item_id),
    CONSTRAINT fk_inventory_cups_item
        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Move existing cups out of "Packaging & Disposables".
UPDATE inventory_items
   SET category = 'Cups'
 WHERE category = 'Packaging & Disposables' AND name REGEXP '[0-9]+ ?oz Cup';

-- Register every cup; size is parsed from the name (e.g. "18oz Cup (Medium)" -> 18).
INSERT IGNORE INTO inventory_cups (inventory_item_id, cup_size_oz)
SELECT id, CAST(REGEXP_REPLACE(REGEXP_SUBSTR(name, '[0-9]+(\\.[0-9]+)? ?oz'), ' ?oz', '') AS DECIMAL(5,1))
  FROM inventory_items
 WHERE category = 'Cups';
