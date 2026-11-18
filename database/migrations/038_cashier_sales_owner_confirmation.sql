-- Migration 038: Cashier Sales Remittance & Owner Confirmation Gate on Store Total Asset Value.
-- Adds dedicated Owner confirmation columns to `orders` and backfills pre-migration paid non-cancelled orders.

SET @sql_038 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'owner_confirmed_at') = 0,
  'ALTER TABLE orders ADD COLUMN owner_confirmed_at DATETIME NULL DEFAULT NULL AFTER paid_by',
  'SELECT 1'
);
PREPARE stmt_038 FROM @sql_038; EXECUTE stmt_038; DEALLOCATE PREPARE stmt_038;

SET @sql_038 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'owner_confirmed_by') = 0,
  'ALTER TABLE orders ADD COLUMN owner_confirmed_by BIGINT UNSIGNED NULL DEFAULT NULL AFTER owner_confirmed_at',
  'SELECT 1'
);
PREPARE stmt_038 FROM @sql_038; EXECUTE stmt_038; DEALLOCATE PREPARE stmt_038;

SET @sql_038 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'owner_confirmation_note') = 0,
  'ALTER TABLE orders ADD COLUMN owner_confirmation_note VARCHAR(255) NULL DEFAULT NULL AFTER owner_confirmed_by',
  'SELECT 1'
);
PREPARE stmt_038 FROM @sql_038; EXECUTE stmt_038; DEALLOCATE PREPARE stmt_038;

SET @sql_038 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND index_name = 'idx_orders_owner_confirmation') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_owner_confirmation (payment_status, order_status, owner_confirmed_at, created_by)',
  'SELECT 1'
);
PREPARE stmt_038 FROM @sql_038; EXECUTE stmt_038; DEALLOCATE PREPARE stmt_038;

SET @sql_038 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND index_name = 'idx_orders_owner_confirmed_by') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_owner_confirmed_by (owner_confirmed_by)',
  'SELECT 1'
);
PREPARE stmt_038 FROM @sql_038; EXECUTE stmt_038; DEALLOCATE PREPARE stmt_038;

SET @sql_038 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND constraint_name = 'fk_orders_owner_confirmed_by') = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_owner_confirmed_by FOREIGN KEY (owner_confirmed_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_038 FROM @sql_038; EXECUTE stmt_038; DEALLOCATE PREPARE stmt_038;

-- Backfill existing pre-migration paid non-cancelled orders so historical seed orders are marked confirmed on upgrade
UPDATE orders
   SET owner_confirmed_at = COALESCE(paid_at, created_at),
       owner_confirmed_by = COALESCE(paid_by, created_by)
 WHERE payment_status = 'Paid'
   AND order_status <> 'Cancelled'
   AND owner_confirmed_at IS NULL;
