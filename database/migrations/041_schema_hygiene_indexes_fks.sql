-- Migration 041: Schema Hygiene, Missing Foreign Keys, Hot-Path Indexes & Precision Alignment
-- Note: Legacy account 6020 ('Utilities & Rent Expense') remains is_active = TRUE to preserve
-- the 42-account COA contract enforced by tests/incomeStatementPhase2.test.js (P2-1).

-- 1. Align inventory_items.category & inventory_categories.name collations and backfill orphan categories
SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_categories'
      AND column_name = 'name'
      AND collation_name <> 'utf8mb4_unicode_ci') > 0,
  'ALTER TABLE inventory_categories MODIFY COLUMN name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_items'
      AND column_name = 'category'
      AND collation_name <> 'utf8mb4_unicode_ci') > 0,
  'ALTER TABLE inventory_items MODIFY COLUMN category VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

INSERT IGNORE INTO inventory_categories (name, description, is_cup_category, is_system, display_order, is_active)
VALUES ('Ingredients', 'General recipe ingredients', 0, 0, 99, TRUE);

INSERT IGNORE INTO inventory_categories (name, description, is_cup_category, is_system, display_order, is_active)
SELECT DISTINCT ii.category, NULL, 0, 0, 99, TRUE
  FROM inventory_items ii
  LEFT JOIN inventory_categories ic ON ic.name = ii.category
 WHERE ii.category IS NOT NULL
   AND ii.category <> ''
   AND ic.name IS NULL;

-- 2. Clean any orphaned references on nullable FK columns before adding FKs
UPDATE journal_entries je
  LEFT JOIN inventory_movements im ON im.id = je.inventory_movement_id
   SET je.inventory_movement_id = NULL
 WHERE je.inventory_movement_id IS NOT NULL
   AND im.id IS NULL;

UPDATE inventory_movements im
  LEFT JOIN inventory_movements im2 ON im2.id = im.reversed_by_movement_id
   SET im.reversed_by_movement_id = NULL
 WHERE im.reversed_by_movement_id IS NOT NULL
   AND im2.id IS NULL;

-- 3. Add missing Foreign Keys (idempotent via information_schema)
SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_items'
      AND constraint_name = 'fk_inventory_items_category') = 0,
  'ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_category FOREIGN KEY (category) REFERENCES inventory_categories (name) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'journal_entries'
      AND constraint_name = 'fk_je_inventory_movement') = 0,
  'ALTER TABLE journal_entries ADD CONSTRAINT fk_je_inventory_movement FOREIGN KEY (inventory_movement_id) REFERENCES inventory_movements (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND constraint_name = 'fk_inventory_movements_reversed_by') = 0,
  'ALTER TABLE inventory_movements ADD CONSTRAINT fk_inventory_movements_reversed_by FOREIGN KEY (reversed_by_movement_id) REFERENCES inventory_movements (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'financial_payables'
      AND constraint_name = 'fk_fp_expense_account') = 0,
  'ALTER TABLE financial_payables ADD CONSTRAINT fk_fp_expense_account FOREIGN KEY (expense_account_code) REFERENCES chart_of_accounts (account_code) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'financial_payables'
      AND constraint_name = 'fk_fp_liability_account') = 0,
  'ALTER TABLE financial_payables ADD CONSTRAINT fk_fp_liability_account FOREIGN KEY (liability_account_code) REFERENCES chart_of_accounts (account_code) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

-- 4. Hot-path indexes & duplicate index cleanup
SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND index_name = 'idx_orders_paid_at') = 0,
  'ALTER TABLE orders ADD INDEX idx_orders_paid_at (paid_at)',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND index_name = 'idx_inventory_movements_created_at') = 0,
  'ALTER TABLE inventory_movements ADD INDEX idx_inventory_movements_created_at (created_at)',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'notifications'
      AND index_name = 'idx_notifications_user_read') = 0,
  'ALTER TABLE notifications ADD INDEX idx_notifications_user_read (user_id, read_at)',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'journal_entry_lines'
      AND index_name = 'idx_jel_account_entry_amounts') = 0,
  'ALTER TABLE journal_entry_lines ADD INDEX idx_jel_account_entry_amounts (account_id, journal_entry_id, debit, credit)',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND index_name = 'idx_inventory_movements_type_created') > 0
  AND
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND index_name = 'idx_inv_mov_type_created') > 0,
  'ALTER TABLE inventory_movements DROP INDEX idx_inventory_movements_type_created',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;

-- 5. Standardize DECIMAL(12,2) on orders.discount_amount & orders.tax_amount
SET @sql_041 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'discount_amount'
      AND column_type <> 'decimal(12,2)') > 0
  OR
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'orders'
      AND column_name = 'tax_amount'
      AND column_type <> 'decimal(12,2)') > 0,
  'ALTER TABLE orders MODIFY COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00, MODIFY COLUMN tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00',
  'SELECT 1'
);
PREPARE stmt_041 FROM @sql_041; EXECUTE stmt_041; DEALLOCATE PREPARE stmt_041;
