-- Migration 025: Reconcile live-vs-migration schema drift, seed business_settings default row, and add reporting indexes.

-- 1. Reconcile inventory_items columns, indexes, and foreign keys
SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND column_name = 'image_url') = 0,
  'ALTER TABLE inventory_items ADD COLUMN image_url LONGTEXT NULL AFTER name',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND column_name = 'archived_by') = 0,
  'ALTER TABLE inventory_items ADD COLUMN archived_by BIGINT UNSIGNED NULL',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND index_name = 'idx_inventory_items_archived') = 0,
  'ALTER TABLE inventory_items ADD KEY idx_inventory_items_archived (archived_at)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND index_name = 'fk_inventory_items_archived_by') = 0,
  'ALTER TABLE inventory_items ADD KEY fk_inventory_items_archived_by (archived_by)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND constraint_name = 'fk_inventory_items_archived_by') = 0,
  'ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_archived_by FOREIGN KEY (archived_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

-- 2. Reconcile menu_products columns, indexes, and foreign keys
SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'archived_by') = 0,
  'ALTER TABLE menu_products ADD COLUMN archived_by BIGINT UNSIGNED NULL',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'low_stock_threshold') = 0,
  'ALTER TABLE menu_products ADD COLUMN low_stock_threshold DECIMAL(12,4) NOT NULL DEFAULT 0.0000',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'cost_price') = 0,
  'ALTER TABLE menu_products ADD COLUMN cost_price DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER base_price',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND index_name = 'idx_menu_products_archived') = 0,
  'ALTER TABLE menu_products ADD KEY idx_menu_products_archived (is_archived, archived_at)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND index_name = 'fk_menu_products_archived_by') = 0,
  'ALTER TABLE menu_products ADD KEY fk_menu_products_archived_by (archived_by)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND constraint_name = 'fk_menu_products_archived_by') = 0,
  'ALTER TABLE menu_products ADD CONSTRAINT fk_menu_products_archived_by FOREIGN KEY (archived_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

-- 3. Reconcile business_settings.target_food_cost and seed default row if empty
SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'target_food_cost') = 0,
  'ALTER TABLE business_settings ADD COLUMN target_food_cost DECIMAL(6,4) NOT NULL DEFAULT 0.3000 AFTER closing_time',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

INSERT INTO business_settings (
  id, business_name, email, phone, address, opening_time, closing_time, target_food_cost
)
SELECT
  1,
  'Amaya''s Drinks and Bites',
  'jessiecataya25@gmail.com',
  '09636017184',
  'Barangay Lilingayon, Valencia City, Bukidnon',
  '09:00:00',
  '19:00:00',
  0.3000
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM business_settings);

-- 4. Add reporting & audit query indexes conditionally
SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_created_at') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_created_at (created_at)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_creator_created') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_creator_created (created_by, created_at)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_status_pay_created') = 0,
  'ALTER TABLE orders ADD KEY idx_orders_status_pay_created (order_status, payment_status, created_at)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inv_mov_user_created') = 0,
  'ALTER TABLE inventory_movements ADD KEY idx_inv_mov_user_created (user_id, created_at)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inv_mov_type_created') = 0,
  'ALTER TABLE inventory_movements ADD KEY idx_inv_mov_type_created (movement_type, created_at)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;

SET @sql_025 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'archive_audit_logs' AND index_name = 'idx_archive_audit_actor_created') = 0,
  'ALTER TABLE archive_audit_logs ADD KEY idx_archive_audit_actor_created (actor_id, created_at)',
  'SELECT 1'
);
PREPARE stmt_025 FROM @sql_025; EXECUTE stmt_025; DEALLOCATE PREPARE stmt_025;
