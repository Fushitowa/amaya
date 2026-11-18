-- Migration 040: Phase 2 DB Hardening
-- 1) Enforce at most one open cashier shift per user at the database constraint level.
-- 2) Enforce end-to-end client_request_id idempotency on orders, inventory_items,
--    inventory_movements (actor-scoped), and order_item_reversals.

SET @sql_040 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cashier_sessions'
      AND column_name = 'open_user_id') = 0,
  "ALTER TABLE cashier_sessions ADD COLUMN open_user_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'open' THEN user_id ELSE NULL END) STORED AFTER status",
  'SELECT 1'
);
PREPARE stmt_040 FROM @sql_040; EXECUTE stmt_040; DEALLOCATE PREPARE stmt_040;

SET @sql_040 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'cashier_sessions'
      AND index_name = 'uq_cashier_sessions_open_user') = 0,
  'ALTER TABLE cashier_sessions ADD UNIQUE KEY uq_cashier_sessions_open_user (open_user_id)',
  'SELECT 1'
);
PREPARE stmt_040 FROM @sql_040; EXECUTE stmt_040; DEALLOCATE PREPARE stmt_040;

-- Orders client_request_id idempotency scoped per creator (created_by, client_request_id)
SET @sql_040 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'client_request_id') = 0,
  'ALTER TABLE orders ADD COLUMN client_request_id VARCHAR(96) NULL AFTER session_id',
  'SELECT 1'
);
PREPARE stmt_040 FROM @sql_040; EXECUTE stmt_040; DEALLOCATE PREPARE stmt_040;

SET @sql_040 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND index_name = 'uq_orders_client_request_id') = 0,
  'ALTER TABLE orders ADD UNIQUE KEY uq_orders_client_request_id (created_by, client_request_id)',
  'SELECT 1'
);
PREPARE stmt_040 FROM @sql_040; EXECUTE stmt_040; DEALLOCATE PREPARE stmt_040;

-- Inventory items creation idempotency
SET @sql_040 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_items'
      AND column_name = 'client_request_id') = 0,
  'ALTER TABLE inventory_items ADD COLUMN client_request_id VARCHAR(96) NULL AFTER unit_cost',
  'SELECT 1'
);
PREPARE stmt_040 FROM @sql_040; EXECUTE stmt_040; DEALLOCATE PREPARE stmt_040;

SET @sql_040 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_items'
      AND index_name = 'uq_inventory_items_client_request_id') = 0,
  'ALTER TABLE inventory_items ADD UNIQUE KEY uq_inventory_items_client_request_id (client_request_id)',
  'SELECT 1'
);
PREPARE stmt_040 FROM @sql_040; EXECUTE stmt_040; DEALLOCATE PREPARE stmt_040;

-- Guard inventory_movements actor-scoped client_request_id index from 034/035
SET @sql_040 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND column_name = 'client_request_id') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN client_request_id VARCHAR(100) NULL',
  'SELECT 1'
);
PREPARE stmt_040 FROM @sql_040; EXECUTE stmt_040; DEALLOCATE PREPARE stmt_040;

SET @sql_040 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND index_name = 'uq_inventory_movements_user_client_request') = 0,
  'ALTER TABLE inventory_movements ADD UNIQUE KEY uq_inventory_movements_user_client_request (user_id, client_request_id)',
  'SELECT 1'
);
PREPARE stmt_040 FROM @sql_040; EXECUTE stmt_040; DEALLOCATE PREPARE stmt_040;

-- Order item reversal idempotency & audit record
CREATE TABLE IF NOT EXISTS order_item_reversals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  order_item_id_snapshot BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  client_request_id VARCHAR(96) NULL,
  reverted_quantity INT NOT NULL,
  restore_stock TINYINT(1) NOT NULL DEFAULT 1,
  reason VARCHAR(255) NOT NULL,
  authorized_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_item_reversals_user_client_request (user_id, client_request_id),
  KEY idx_order_item_reversals_order (order_id, id),
  CONSTRAINT fk_order_item_reversals_order
    FOREIGN KEY (order_id) REFERENCES orders (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_order_item_reversals_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_order_item_reversals_authorized_by
    FOREIGN KEY (authorized_by) REFERENCES users (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
