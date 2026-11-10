-- Migration 027: Structured inventory movements (cost, unit, before/after quantities, supplier/reference, and order provenance).

-- 1. Widen movement_type ENUM to include spoilage and void_restore
ALTER TABLE inventory_movements
  MODIFY COLUMN movement_type ENUM('restock', 'adjustment', 'usage', 'spoilage', 'void_restore') NOT NULL;

-- 2. Add structured snapshot, quantity reconciliation, purchasing cost, and provenance columns conditionally
SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'item_name_snapshot') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN item_name_snapshot VARCHAR(160) NULL AFTER movement_type',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'actor_name_snapshot') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN actor_name_snapshot VARCHAR(100) NULL AFTER user_id',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'before_quantity') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN before_quantity DECIMAL(16,6) NULL AFTER quantity_change',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'after_quantity') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN after_quantity DECIMAL(16,6) NULL AFTER before_quantity',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'unit') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN unit VARCHAR(40) NULL AFTER after_quantity',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'batch_cost') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN batch_cost DECIMAL(12,2) NULL AFTER unit',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'unit_cost_before') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN unit_cost_before DECIMAL(14,6) NULL AFTER batch_cost',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'unit_cost_after') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN unit_cost_after DECIMAL(14,6) NULL AFTER unit_cost_before',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'supplier_name') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN supplier_name VARCHAR(120) NULL AFTER unit_cost_after',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'reference_no') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN reference_no VARCHAR(80) NULL AFTER supplier_name',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'order_id') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN order_id BIGINT UNSIGNED NULL AFTER reference_no',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_order') = 0,
  'ALTER TABLE inventory_movements ADD KEY idx_inventory_movements_order (order_id)',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

SET @sql_027 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND constraint_name = 'fk_inventory_movements_order') = 0,
  'ALTER TABLE inventory_movements ADD CONSTRAINT fk_inventory_movements_order FOREIGN KEY (order_id) REFERENCES orders (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_027 FROM @sql_027; EXECUTE stmt_027; DEALLOCATE PREPARE stmt_027;

-- 3. Backfill item_name_snapshot, unit, and actor_name_snapshot from existing truth without fabricating historical quantities/costs
UPDATE inventory_movements m
  JOIN inventory_items ii ON ii.id = m.inventory_item_id
   SET m.item_name_snapshot = COALESCE(NULLIF(m.item_name_snapshot, ''), ii.name),
       m.unit = COALESCE(NULLIF(m.unit, ''), ii.unit)
 WHERE m.item_name_snapshot IS NULL OR m.unit IS NULL;

UPDATE inventory_movements m
  LEFT JOIN users u ON u.id = m.user_id
   SET m.actor_name_snapshot = COALESCE(NULLIF(TRIM(u.display_name), ''), u.username, 'System')
 WHERE m.actor_name_snapshot IS NULL;

-- Link existing usage movements to matching orders by order_number when present (non-destructive)
UPDATE inventory_movements m
  JOIN orders o
    ON m.movement_type = 'usage'
   AND m.note LIKE 'Order AM-%:%'
   AND o.order_number COLLATE utf8mb4_unicode_ci = SUBSTRING(SUBSTRING_INDEX(m.note, ':', 1), 7) COLLATE utf8mb4_unicode_ci
   SET m.order_id = o.id
 WHERE m.order_id IS NULL;
