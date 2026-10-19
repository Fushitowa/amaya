USE amaya;

-- Removed inventory items stay in the database so stock movements and order
-- consumption records remain intact. A generated key keeps names unique only
-- among active items, allowing the same item to be added again later.
ALTER TABLE inventory_items
    ADD COLUMN archived_at DATETIME NULL AFTER updated_at,
    DROP INDEX uq_inventory_items_name,
    ADD COLUMN active_name VARCHAR(160)
        GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN name ELSE NULL END) STORED,
    ADD UNIQUE KEY uq_inventory_items_active_name (active_name);
