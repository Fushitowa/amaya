-- Migration 026: Order stage audit actors, non-destructive Cancelled void trail, add-on COGS source discriminator, and strict users.display_name.

-- 1. Extend orders.order_status ENUM with 'Cancelled' (zero refund logic)
ALTER TABLE orders
  MODIFY COLUMN order_status ENUM('Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Pending';

-- 2. Add order notes, stage actors, completion timestamps, and non-destructive void audit fields
SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'notes') = 0,
  'ALTER TABLE orders ADD COLUMN notes VARCHAR(500) NULL AFTER customer_name',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'confirmed_by') = 0,
  'ALTER TABLE orders ADD COLUMN confirmed_by BIGINT UNSIGNED NULL AFTER confirmed_at',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'paid_by') = 0,
  'ALTER TABLE orders ADD COLUMN paid_by BIGINT UNSIGNED NULL AFTER paid_at',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'completed_by') = 0,
  'ALTER TABLE orders ADD COLUMN completed_by BIGINT UNSIGNED NULL AFTER created_by',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'completed_at') = 0,
  'ALTER TABLE orders ADD COLUMN completed_at DATETIME NULL AFTER completed_by',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'voided_by') = 0,
  'ALTER TABLE orders ADD COLUMN voided_by BIGINT UNSIGNED NULL AFTER completed_at',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'voided_at') = 0,
  'ALTER TABLE orders ADD COLUMN voided_at DATETIME NULL AFTER voided_by',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'void_reason') = 0,
  'ALTER TABLE orders ADD COLUMN void_reason VARCHAR(255) NULL AFTER voided_at',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

-- Indexes and FKs for stage actors on orders
SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_confirmed_by') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_confirmed_by (confirmed_by)',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_paid_by') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_paid_by (paid_by)',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_completed_by') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_completed_by (completed_by)',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_voided_by') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_voided_by (voided_by, voided_at)',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'orders' AND constraint_name = 'fk_orders_confirmed_by') = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'orders' AND constraint_name = 'fk_orders_paid_by') = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_paid_by FOREIGN KEY (paid_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'orders' AND constraint_name = 'fk_orders_completed_by') = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_completed_by FOREIGN KEY (completed_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'orders' AND constraint_name = 'fk_orders_voided_by') = 0,
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

-- 3. Immutable order_status_events audit table + initial backfill
CREATE TABLE IF NOT EXISTS order_status_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id BIGINT UNSIGNED NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    changed_by BIGINT UNSIGNED NULL,
    actor_name_snapshot VARCHAR(100) NOT NULL DEFAULT 'System',
    reason VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_order_status_events_order (order_id, created_at),
    KEY idx_order_status_events_actor (changed_by, created_at),
    CONSTRAINT fk_order_status_events_order
        FOREIGN KEY (order_id) REFERENCES orders (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_status_events_actor
        FOREIGN KEY (changed_by) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason, created_at)
SELECT o.id,
       NULL,
       o.order_status,
       o.created_by,
       COALESCE(NULLIF(TRIM(o.cashier_name), ''), NULLIF(TRIM(u.display_name), ''), u.username, 'System'),
       'Initial order status (backfilled)',
       o.created_at
  FROM orders o
  LEFT JOIN users u ON u.id = o.created_by
 WHERE NOT EXISTS (
   SELECT 1 FROM order_status_events ose WHERE ose.order_id = o.id
 );

-- 4. Split order_inventory_consumptions by source ('recipe' vs 'addon') safely preserving FK index
SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'order_inventory_consumptions' AND column_name = 'source') = 0,
  'ALTER TABLE order_inventory_consumptions ADD COLUMN source ENUM(''recipe'', ''addon'') NOT NULL DEFAULT ''recipe'' AFTER inventory_item_name_snapshot',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

-- Add new composite unique key FIRST so fk_order_inventory_consumptions_item keeps a valid leftmost index before dropping the old key
SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'order_inventory_consumptions' AND index_name = 'uq_order_line_inventory_source') = 0,
  'ALTER TABLE order_inventory_consumptions ADD UNIQUE KEY uq_order_line_inventory_source (order_item_id, inventory_item_id, source)',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

SET @sql_026 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'order_inventory_consumptions' AND index_name = 'uq_order_line_inventory') > 0,
  'ALTER TABLE order_inventory_consumptions DROP INDEX uq_order_line_inventory',
  'SELECT 1'
);
PREPARE stmt_026 FROM @sql_026; EXECUTE stmt_026; DEALLOCATE PREPARE stmt_026;

-- 5. Backfill blank/null users.display_name safely without violating uq_users_display_name, then set NOT NULL
UPDATE users u
   SET u.display_name = CASE
     WHEN u.role = 'admin' AND NOT EXISTS (SELECT 1 FROM (SELECT id, display_name FROM users) x WHERE LOWER(x.display_name) = 'admin (owner)' AND x.id <> u.id) THEN 'Admin (Owner)'
     WHEN NOT EXISTS (SELECT 1 FROM (SELECT id, display_name FROM users) x WHERE LOWER(x.display_name) = LOWER(u.username) AND x.id <> u.id) THEN u.username
     ELSE CONCAT('Cashier ', u.id)
   END
 WHERE u.display_name IS NULL OR TRIM(u.display_name) = '';

ALTER TABLE users
  MODIFY COLUMN display_name VARCHAR(100) NOT NULL DEFAULT '';
