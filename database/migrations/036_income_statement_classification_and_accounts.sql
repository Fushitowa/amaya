-- Migration 036: Income Statement Classification (report_section, expense_group),
-- Separated Phase 1 OPEX Accounts (6120, 6130, 6140, 6144, 6172),
-- and Internal Store Use inventory movement type.

-- 1. Add report_section to chart_of_accounts idempotently
SET @sql_036 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'chart_of_accounts'
      AND column_name = 'report_section') = 0,
  "ALTER TABLE chart_of_accounts ADD COLUMN report_section ENUM('revenue','contra_revenue','cogs','opex','depreciation','tax','balance_sheet') NOT NULL DEFAULT 'balance_sheet' AFTER normal_balance",
  'SELECT 1'
);
PREPARE stmt_036 FROM @sql_036; EXECUTE stmt_036; DEALLOCATE PREPARE stmt_036;

-- 2. Add expense_group to chart_of_accounts idempotently
SET @sql_036 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'chart_of_accounts'
      AND column_name = 'expense_group') = 0,
  'ALTER TABLE chart_of_accounts ADD COLUMN expense_group VARCHAR(80) NULL AFTER report_section',
  'SELECT 1'
);
PREPARE stmt_036 FROM @sql_036; EXECUTE stmt_036; DEALLOCATE PREPARE stmt_036;

-- 3. Backfill report_section and expense_group on existing accounts
UPDATE chart_of_accounts
   SET report_section = 'balance_sheet',
       expense_group = NULL
 WHERE account_category IN ('asset', 'liability', 'equity')
    OR account_code IN ('1010', '1020', '1030', '1040', '1050', '1510', '2010', '2020', '3010', '3020');

UPDATE chart_of_accounts
   SET report_section = 'revenue',
       expense_group = NULL
 WHERE account_code = '4010';

UPDATE chart_of_accounts
   SET report_section = 'contra_revenue',
       expense_group = NULL
 WHERE account_code = '4020';

UPDATE chart_of_accounts
   SET report_section = 'cogs',
       expense_group = NULL
 WHERE account_code IN ('5010', '6030');

UPDATE chart_of_accounts
   SET report_section = 'opex',
       expense_group = 'Others'
 WHERE account_code IN ('6010', '6040');

UPDATE chart_of_accounts
   SET report_section = 'opex',
       expense_group = 'Utilities & Rent (Legacy)'
 WHERE account_code = '6020';

-- 4. Seed separated Phase 1 OPEX accounts
INSERT INTO chart_of_accounts (
  account_code,
  account_name,
  account_category,
  normal_balance,
  is_system_locked,
  report_section,
  expense_group
)
VALUES
  ('6120', 'Rent & Occupancy', 'expense', 'debit', FALSE, 'opex', 'Rent & Occupancy'),
  ('6130', 'Utilities', 'expense', 'debit', FALSE, 'opex', 'Utilities'),
  ('6140', 'Operating Supplies', 'expense', 'debit', FALSE, 'opex', 'Operating Supplies'),
  ('6144', 'Sanitation Supplies', 'expense', 'debit', FALSE, 'opex', 'Operating Supplies'),
  ('6172', 'Taxes & Licenses (Permits)', 'expense', 'debit', FALSE, 'opex', 'General & Administrative (G&A)')
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  report_section = VALUES(report_section),
  expense_group = VALUES(expense_group);

-- 5. Widen inventory_movements.movement_type ENUM to include 'internal_use' idempotently
SET @sql_036 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND column_name = 'movement_type'
      AND COLUMN_TYPE NOT LIKE "%'internal_use'%") > 0,
  "ALTER TABLE inventory_movements MODIFY COLUMN movement_type ENUM('restock', 'adjustment', 'usage', 'spoilage', 'void_restore', 'internal_use') NOT NULL",
  'SELECT 1'
);
PREPARE stmt_036 FROM @sql_036; EXECUTE stmt_036; DEALLOCATE PREPARE stmt_036;
