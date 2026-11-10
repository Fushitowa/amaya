-- Migration 028: Cashier shift sessions & cash drawer reconciliation linked to orders and inventory movements.

CREATE TABLE IF NOT EXISTS cashier_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    cashier_name_snapshot VARCHAR(100) NOT NULL,
    terminal_label VARCHAR(80) NOT NULL DEFAULT 'Counter 1',
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    opening_float DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    expected_cash DECIMAL(12,2) NULL,
    counted_cash DECIMAL(12,2) NULL,
    variance DECIMAL(12,2) NULL,
    closing_notes VARCHAR(500) NULL,
    closed_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cashier_sessions_user_opened (user_id, opened_at),
    KEY idx_cashier_sessions_status_opened (status, opened_at),
    CONSTRAINT fk_cashier_sessions_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_cashier_sessions_closed_by
        FOREIGN KEY (closed_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attach session_id to orders
SET @sql_028 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'session_id') = 0,
  'ALTER TABLE orders ADD COLUMN session_id BIGINT UNSIGNED NULL AFTER created_by',
  'SELECT 1'
);
PREPARE stmt_028 FROM @sql_028; EXECUTE stmt_028; DEALLOCATE PREPARE stmt_028;

SET @sql_028 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_session') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_session (session_id)',
  'SELECT 1'
);
PREPARE stmt_028 FROM @sql_028; EXECUTE stmt_028; DEALLOCATE PREPARE stmt_028;

SET @sql_028 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'orders' AND constraint_name = 'fk_orders_session') = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_session FOREIGN KEY (session_id) REFERENCES cashier_sessions (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_028 FROM @sql_028; EXECUTE stmt_028; DEALLOCATE PREPARE stmt_028;

-- Attach session_id to inventory_movements
SET @sql_028 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'session_id') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN session_id BIGINT UNSIGNED NULL AFTER order_id',
  'SELECT 1'
);
PREPARE stmt_028 FROM @sql_028; EXECUTE stmt_028; DEALLOCATE PREPARE stmt_028;

SET @sql_028 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_session') = 0,
  'ALTER TABLE inventory_movements ADD KEY idx_inventory_movements_session (session_id)',
  'SELECT 1'
);
PREPARE stmt_028 FROM @sql_028; EXECUTE stmt_028; DEALLOCATE PREPARE stmt_028;

SET @sql_028 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND constraint_name = 'fk_inventory_movements_session') = 0,
  'ALTER TABLE inventory_movements ADD CONSTRAINT fk_inventory_movements_session FOREIGN KEY (session_id) REFERENCES cashier_sessions (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_028 FROM @sql_028; EXECUTE stmt_028; DEALLOCATE PREPARE stmt_028;
