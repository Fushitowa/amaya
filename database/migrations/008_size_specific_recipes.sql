USE amaya;

-- Store ingredient amounts by serving size. Existing product_ingredients rows
-- remain the default recipe for older menu items and sizes without overrides.
CREATE TABLE IF NOT EXISTS product_size_ingredients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_size_id BIGINT UNSIGNED NOT NULL,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    quantity_used DECIMAL(12,3) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_product_size_ingredient (product_size_id, inventory_item_id),
    KEY idx_product_size_ingredients_inventory (inventory_item_id),
    CONSTRAINT fk_product_size_ingredients_size
        FOREIGN KEY (product_size_id) REFERENCES product_sizes (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_product_size_ingredients_inventory
        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
