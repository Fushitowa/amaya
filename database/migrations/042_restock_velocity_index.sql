-- Migration 042: Covering velocity index for Smart Restock Engine
SET @sql_042 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'order_inventory_consumptions'
      AND index_name = 'idx_oic_rev_inv_order') = 0,
  'ALTER TABLE order_inventory_consumptions ADD INDEX idx_oic_rev_inv_order (reversed_at, inventory_item_id, order_id)',
  'SELECT 1'
);
PREPARE stmt_042 FROM @sql_042; EXECUTE stmt_042; DEALLOCATE PREPARE stmt_042;
