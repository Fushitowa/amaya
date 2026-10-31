-- Migration 021: Cashier Management and Order Attribution
-- Allows shared 'staff' username with individual cashier passwords and display names.
-- Tracks cashier in charge for each order.

USE amaya;

-- 1. Add display_name column to users table if not exists
SET @exist_display_name := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'display_name'
);

SET @sql_users_display := IF(
    @exist_display_name = 0,
    'ALTER TABLE users ADD COLUMN display_name VARCHAR(100) NULL AFTER username;',
    'SELECT "display_name already exists";'
);
PREPARE stmt_display FROM @sql_users_display;
EXECUTE stmt_display;
DEALLOCATE PREPARE stmt_display;

-- 2. Populate display_name for existing users and rename legacy 'juan' to 'staff'
UPDATE users SET display_name = 'Admin (Owner)' WHERE username = 'admin' AND (display_name IS NULL OR display_name = '');
UPDATE users SET username = 'staff', display_name = 'Cashier 1' WHERE username = 'juan' AND role = 'staff';
UPDATE users SET display_name = CONCAT('Cashier ', id) WHERE (display_name IS NULL OR display_name = '') AND role = 'staff';
UPDATE users SET display_name = 'Admin' WHERE display_name IS NULL OR display_name = '';

-- 3. Drop single-column unique index on username to allow multiple staff members with username 'staff'
SET @exist_uq_username := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'uq_users_username'
);

SET @sql_drop_uq := IF(
    @exist_uq_username > 0,
    'ALTER TABLE users DROP INDEX uq_users_username;',
    'SELECT "uq_users_username already dropped";'
);
PREPARE stmt_drop_uq FROM @sql_drop_uq;
EXECUTE stmt_drop_uq;
DEALLOCATE PREPARE stmt_drop_uq;

-- 4. Add unique index on display_name to ensure cashier names are unique
SET @exist_uq_display := (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND INDEX_NAME = 'uq_users_display_name'
);

SET @sql_add_uq_display := IF(
    @exist_uq_display = 0,
    'ALTER TABLE users ADD UNIQUE KEY uq_users_display_name (display_name);',
    'SELECT "uq_users_display_name already exists";'
);
PREPARE stmt_add_uq_display FROM @sql_add_uq_display;
EXECUTE stmt_add_uq_display;
DEALLOCATE PREPARE stmt_add_uq_display;

-- 5. Add cashier_name column to orders table
SET @exist_cashier_name := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'cashier_name'
);

SET @sql_orders_cashier := IF(
    @exist_cashier_name = 0,
    'ALTER TABLE orders ADD COLUMN cashier_name VARCHAR(100) NULL AFTER created_by;',
    'SELECT "cashier_name already exists";'
);
PREPARE stmt_cashier FROM @sql_orders_cashier;
EXECUTE stmt_cashier;
DEALLOCATE PREPARE stmt_cashier;

-- 6. Backfill existing orders with cashier_name from created_by user
UPDATE orders o
LEFT JOIN users u ON u.id = o.created_by
SET o.cashier_name = COALESCE(u.display_name, 'Cashier 1')
WHERE o.cashier_name IS NULL;
