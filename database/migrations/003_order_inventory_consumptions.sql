-- Preserve exact ingredient usage per order line so canceled orders can be
-- reversed safely even after a menu recipe changes.
USE amaya;

CREATE TABLE IF NOT EXISTS order_inventory_consumptions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id BIGINT UNSIGNED NULL,
    order_item_id BIGINT UNSIGNED NULL,
    order_number VARCHAR(32) NOT NULL,
    product_name_snapshot VARCHAR(160) NOT NULL,
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    inventory_item_name_snapshot VARCHAR(160) NOT NULL,
    quantity_used DECIMAL(12,3) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    reversed_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_order_line_inventory (order_item_id, inventory_item_id),
    KEY idx_order_inventory_consumptions_order (order_id),
    KEY idx_order_inventory_consumptions_inventory (inventory_item_id, created_at),
    CONSTRAINT fk_order_inventory_consumptions_order
        FOREIGN KEY (order_id) REFERENCES orders (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_order_inventory_consumptions_item
        FOREIGN KEY (order_item_id) REFERENCES order_items (id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_order_inventory_consumptions_inventory
        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
