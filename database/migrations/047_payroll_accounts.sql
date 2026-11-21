-- Migration 047: Payroll accounts (Phase 1 of docs/PAYROLL_IMPLEMENTATION_PLAN.md).
-- * Splits Labor & Payroll into its own accounts so Salary, Wages, Overtime, Government
--   Contributions and 13th Month each have a ledger account (fixes the shared-6111 double count).
-- * Adds the payroll liabilities (2040 / 2045 / 2050 / 2060).
-- * Lets financial_payables hold payroll and statutory (SSS / PhilHealth / Pag-IBIG / BIR) bills.
--
-- History note: 6111 is renamed, not moved. Older 6111 entries stay where they are and now read as
-- Salary. Past expenses tagged "wages" or "overtime" keep their tag, so they still count under
-- those categories; untagged older 6111 entries count under Salary only.

-- 1. Chart of accounts
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
  ('2040', 'Salaries & Wages Payable', 'liability', 'credit', FALSE, 'balance_sheet', NULL),
  ('2045', '13th Month Pay Payable', 'liability', 'credit', FALSE, 'balance_sheet', NULL),
  ('2050', 'SSS / PhilHealth / Pag-IBIG Payable', 'liability', 'credit', FALSE, 'balance_sheet', NULL),
  ('2060', 'Withholding Tax on Compensation Payable', 'liability', 'credit', FALSE, 'balance_sheet', NULL),
  ('6111', 'Salaries (Monthly-rated Staff)', 'expense', 'debit', FALSE, 'opex', 'Labor & Payroll'),
  ('6112', 'Employer Contributions (SSS / PhilHealth / Pag-IBIG)', 'expense', 'debit', FALSE, 'opex', 'Labor & Payroll'),
  ('6114', '13th Month Pay', 'expense', 'debit', FALSE, 'opex', 'Labor & Payroll'),
  ('6115', 'Wages (Daily / Hourly Staff)', 'expense', 'debit', FALSE, 'opex', 'Labor & Payroll'),
  ('6116', 'Overtime & Premium Pay', 'expense', 'debit', FALSE, 'opex', 'Labor & Payroll')
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  account_category = VALUES(account_category),
  normal_balance = VALUES(normal_balance),
  report_section = VALUES(report_section),
  expense_group = VALUES(expense_group);

-- 2. Expense categories for the two new Labor and Payroll pages
INSERT INTO expense_categories (slug, label) VALUES
  ('government-contributions', 'Government Contributions'),
  ('thirteenth-month', '13th Month Pay')
ON DUPLICATE KEY UPDATE label = VALUES(label);

-- 3. financial_payables.bill_category: add payroll and statutory
SET @sql_047 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'financial_payables'
      AND column_name = 'bill_category'
      AND (COLUMN_TYPE NOT LIKE "%'payroll'%" OR COLUMN_TYPE NOT LIKE "%'statutory'%")) > 0,
  "ALTER TABLE financial_payables MODIFY COLUMN bill_category ENUM('opex','inventory_restock','income_tax','payroll','statutory') NOT NULL",
  'SELECT 1'
);
PREPARE stmt_047 FROM @sql_047; EXECUTE stmt_047; DEALLOCATE PREPARE stmt_047;

-- 4. financial_payables.liability_account_code: allow the payroll liabilities
SET @sql_047 = IF(
  (SELECT COUNT(*) FROM information_schema.check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'financial_payables'
      AND constraint_name = 'chk_fp_liability_code'
      AND check_clause NOT LIKE '%2040%') > 0,
  'ALTER TABLE financial_payables DROP CONSTRAINT chk_fp_liability_code',
  'SELECT 1'
);
PREPARE stmt_047 FROM @sql_047; EXECUTE stmt_047; DEALLOCATE PREPARE stmt_047;

SET @sql_047 = IF(
  (SELECT COUNT(*) FROM information_schema.check_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'financial_payables'
      AND constraint_name = 'chk_fp_liability_code') = 0,
  "ALTER TABLE financial_payables ADD CONSTRAINT chk_fp_liability_code CHECK (liability_account_code IN ('2010', '2030', '2040', '2045', '2050', '2060'))",
  'SELECT 1'
);
PREPARE stmt_047 FROM @sql_047; EXECUTE stmt_047; DEALLOCATE PREPARE stmt_047;
