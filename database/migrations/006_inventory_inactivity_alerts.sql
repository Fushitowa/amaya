USE amaya;

CREATE TABLE IF NOT EXISTS inventory_inactivity_states (
    inventory_item_id BIGINT UNSIGNED NOT NULL,
    last_activity_at DATETIME NOT NULL,
    is_inactive BOOLEAN NOT NULL DEFAULT FALSE,
    checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (inventory_item_id),
    CONSTRAINT fk_inventory_inactivity_states_item
        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
