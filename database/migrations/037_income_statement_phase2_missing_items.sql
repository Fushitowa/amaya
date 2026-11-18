-- Migration 037: Income Statement Phase 2 Missing Items (20 COA Accounts,
-- Expanded journal_entries.entry_type ENUM, and financial_payables Subledger).

-- 1. Seed 20 Phase 2 Chart of Accounts rows (22 existing + 20 new = 42 active accounts)
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
  ('1520', 'Accumulated Depreciation', 'asset', 'credit', FALSE, 'balance_sheet', NULL),
  ('2030', 'Income Tax Payable', 'liability', 'credit', FALSE, 'balance_sheet', NULL),
  ('6111', 'Salaries, Wages & Overtime', 'expense', 'debit', FALSE, 'opex', 'Labor & Payroll'),
  ('6112', 'Mandatory Benefits (SSS / PhilHealth / Pag-IBIG)', 'expense', 'debit', FALSE, 'opex', 'Labor & Payroll'),
  ('6113', 'Employee Benefits (Staff Meals)', 'expense', 'debit', FALSE, 'opex', 'Labor & Payroll'),
  ('6131', 'Electricity', 'expense', 'debit', FALSE, 'opex', 'Utilities'),
  ('6132', 'Water', 'expense', 'debit', FALSE, 'opex', 'Utilities'),
  ('6133', 'LPG / Cooking Gas', 'expense', 'debit', FALSE, 'opex', 'Utilities'),
  ('6134', 'Internet & Telecommunications', 'expense', 'debit', FALSE, 'opex', 'Utilities'),
  ('6141', 'Linen & Uniforms', 'expense', 'debit', FALSE, 'opex', 'Operating Supplies'),
  ('6142', 'Dining Supplies', 'expense', 'debit', FALSE, 'opex', 'Operating Supplies'),
  ('6143', 'Kitchen Supplies', 'expense', 'debit', FALSE, 'opex', 'Operating Supplies'),
  ('6150', 'Advertising & Marketing', 'expense', 'debit', FALSE, 'opex', 'Advertising & Marketing'),
  ('6160', 'Repairs & Maintenance', 'expense', 'debit', FALSE, 'opex', 'Repairs & Maintenance'),
  ('6171', 'Office Expenses', 'expense', 'debit', FALSE, 'opex', 'General & Administrative (G&A)'),
  ('6173', 'Professional & Bank Fees', 'expense', 'debit', FALSE, 'opex', 'General & Administrative (G&A)'),
  ('6174', 'Transportation & Travel', 'expense', 'debit', FALSE, 'opex', 'General & Administrative (G&A)'),
  ('6179', 'Miscellaneous', 'expense', 'debit', FALSE, 'opex', 'General & Administrative (G&A)'),
  ('6210', 'Depreciation Expense', 'expense', 'debit', FALSE, 'depreciation', NULL),
  ('6310', 'Income Tax Expense', 'expense', 'debit', FALSE, 'tax', NULL)
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  account_category = VALUES(account_category),
  normal_balance = VALUES(normal_balance),
  report_section = VALUES(report_section),
  expense_group = VALUES(expense_group);

-- 2. Idempotently widen journal_entries.entry_type ENUM (retaining all 10 existing + 3 Phase 2 types)
SET @sql_037 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'journal_entries'
      AND column_name = 'entry_type'
      AND (
        COLUMN_TYPE NOT LIKE "%'ap_settlement'%"
        OR COLUMN_TYPE NOT LIKE "%'depreciation'%"
        OR COLUMN_TYPE NOT LIKE "%'income_tax'%"
      )) > 0,
  "ALTER TABLE journal_entries MODIFY COLUMN entry_type ENUM('opening_balance','sales_revenue','cogs_consumption','inventory_restock','operating_expense','capital_injection','owner_withdrawal','account_transfer','void_reversal','adjustment','ap_settlement','depreciation','income_tax') NOT NULL",
  'SELECT 1'
);
PREPARE stmt_037 FROM @sql_037; EXECUTE stmt_037; DEALLOCATE PREPARE stmt_037;

-- 3. Create financial_payables subledger for tracked 2010 AP & 2030 Tax Payable settlements
CREATE TABLE IF NOT EXISTS financial_payables (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bill_number VARCHAR(40) NOT NULL,
  bill_category ENUM('opex', 'inventory_restock', 'income_tax') NOT NULL,
  vendor_name VARCHAR(120) NULL,
  expense_account_code VARCHAR(20) NOT NULL,
  liability_account_code VARCHAR(20) NOT NULL,
  bill_date DATE NOT NULL,
  due_date DATE NULL,
  original_amount DECIMAL(14,2) NOT NULL,
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  status ENUM('unpaid', 'partial', 'paid', 'voided') NOT NULL DEFAULT 'unpaid',
  incurred_journal_entry_id BIGINT UNSIGNED NOT NULL,
  session_id BIGINT UNSIGNED NULL,
  notes VARCHAR(500) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fp_bill_number (bill_number),
  UNIQUE KEY uq_fp_incurred_je (incurred_journal_entry_id),
  KEY idx_fp_status_category (status, bill_category),
  KEY idx_fp_liability_status (liability_account_code, status),
  CONSTRAINT chk_fp_amounts CHECK (original_amount > 0.00 AND paid_amount >= 0.00 AND paid_amount <= original_amount),
  CONSTRAINT chk_fp_liability_code CHECK (liability_account_code IN ('2010', '2030')),
  CONSTRAINT fk_fp_incurred_je FOREIGN KEY (incurred_journal_entry_id) REFERENCES journal_entries (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_fp_session FOREIGN KEY (session_id) REFERENCES cashier_sessions (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_fp_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Idempotently add journal_entries.payable_id + index + FK (ON DELETE SET NULL)
SET @sql_037 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'journal_entries'
      AND column_name = 'payable_id') = 0,
  'ALTER TABLE journal_entries ADD COLUMN payable_id BIGINT UNSIGNED NULL AFTER session_id',
  'SELECT 1'
);
PREPARE stmt_037 FROM @sql_037; EXECUTE stmt_037; DEALLOCATE PREPARE stmt_037;

SET @sql_037 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'journal_entries'
      AND index_name = 'idx_je_payable') = 0,
  'ALTER TABLE journal_entries ADD KEY idx_je_payable (payable_id)',
  'SELECT 1'
);
PREPARE stmt_037 FROM @sql_037; EXECUTE stmt_037; DEALLOCATE PREPARE stmt_037;

SET @sql_037 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'journal_entries'
      AND constraint_name = 'fk_je_payable') = 0,
  'ALTER TABLE journal_entries ADD CONSTRAINT fk_je_payable FOREIGN KEY (payable_id) REFERENCES financial_payables (id) ON UPDATE CASCADE ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_037 FROM @sql_037; EXECUTE stmt_037; DEALLOCATE PREPARE stmt_037;
