USE amaya;

-- Widen inventory unit_cost to 6 decimals for sub-gram/sub-milliliter weighted-average costing
ALTER TABLE inventory_items
    MODIFY COLUMN unit_cost DECIMAL(14,6) NOT NULL DEFAULT 0.000000;

-- Idempotently ensure order_items has unit_cost_snapshot
SET @cost_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'order_items' AND column_name = 'unit_cost_snapshot') = 0,
  'ALTER TABLE order_items ADD COLUMN unit_cost_snapshot DECIMAL(12,4) NULL AFTER unit_price',
  'SELECT 1'
);
PREPARE cost_stmt FROM @cost_sql;
EXECUTE cost_stmt;
DEALLOCATE PREPARE cost_stmt;

-- Idempotently ensure order_inventory_consumptions has unit_cost_snapshot and line_cost
SET @cost_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'order_inventory_consumptions' AND column_name = 'unit_cost_snapshot') = 0,
  'ALTER TABLE order_inventory_consumptions ADD COLUMN unit_cost_snapshot DECIMAL(14,6) NULL AFTER unit',
  'SELECT 1'
);
PREPARE cost_stmt FROM @cost_sql;
EXECUTE cost_stmt;
DEALLOCATE PREPARE cost_stmt;

SET @cost_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'order_inventory_consumptions' AND column_name = 'line_cost') = 0,
  'ALTER TABLE order_inventory_consumptions ADD COLUMN line_cost DECIMAL(12,4) NULL AFTER unit_cost_snapshot',
  'SELECT 1'
);
PREPARE cost_stmt FROM @cost_sql;
EXECUTE cost_stmt;
DEALLOCATE PREPARE cost_stmt;
