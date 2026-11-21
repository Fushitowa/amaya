-- Migration 051: Operating costs to the restaurant standard, USAR (Phase 3B of
-- docs/PAYROLL_IMPLEMENTATION_PLAN.md).
-- * New report_section 'occupancy' for non-controllable occupancy costs (rent, building insurance,
--   real property tax). They sit below Controllable Income on the P&L.
-- * 6135 Trash & Garbage Collection (Utilities); 6125 Building Insurance & Real Property Tax.
-- * 6120 becomes "Rent" under Occupancy; 6134 becomes "Telephone & Internet" under G&A;
--   6040 becomes "Cash (Over)/Short" under G&A.
-- * New expense-category pages and the utility_bills tables (bills dated by service period).
-- Older entries are never rewritten (D9); they read under the new names and groups.

-- 1. report_section: add 'occupancy'
SET @sql_051 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'chart_of_accounts' AND column_name = 'report_section'
      AND COLUMN_TYPE NOT LIKE "%'occupancy'%") > 0,
  "ALTER TABLE chart_of_accounts MODIFY COLUMN report_section ENUM('revenue','contra_revenue','cogs','opex','occupancy','depreciation','tax','balance_sheet') NOT NULL DEFAULT 'balance_sheet'",
  'SELECT 1'
);
PREPARE stmt_051 FROM @sql_051; EXECUTE stmt_051; DEALLOCATE PREPARE stmt_051;

-- 2. Chart of accounts
INSERT INTO chart_of_accounts (
  account_code, account_name, account_category, normal_balance, is_system_locked, report_section, expense_group
)
VALUES
  ('6120', 'Rent', 'expense', 'debit', FALSE, 'occupancy', 'Occupancy'),
  ('6125', 'Building Insurance & Real Property Tax', 'expense', 'debit', FALSE, 'occupancy', 'Occupancy'),
  ('6134', 'Telephone & Internet', 'expense', 'debit', FALSE, 'opex', 'General & Administrative (G&A)'),
  ('6135', 'Trash & Garbage Collection', 'expense', 'debit', FALSE, 'opex', 'Utilities'),
  ('6150', 'Advertising & Marketing', 'expense', 'debit', FALSE, 'opex', 'Marketing')
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  account_category = VALUES(account_category),
  normal_balance = VALUES(normal_balance),
  report_section = VALUES(report_section),
  expense_group = VALUES(expense_group);

-- 6040 is system-locked (shift close posts to it), so only its label and group change.
UPDATE chart_of_accounts
   SET account_name = 'Cash (Over)/Short', expense_group = 'General & Administrative (G&A)'
 WHERE account_code = '6040';

-- 3. Expense-category pages
INSERT INTO expense_categories (slug, label) VALUES
  ('trash-collection', 'Trash Collection'),
  ('other-utilities', 'Other Utilities'),
  ('occupancy', 'Occupancy'),
  ('rent', 'Rent'),
  ('building-insurance-and-taxes', 'Building Insurance & Taxes'),
  ('marketing', 'Marketing'),
  ('internet', 'Telephone & Internet'),
  ('cash-over-short', 'Cash Over/Short')
ON DUPLICATE KEY UPDATE label = VALUES(label);

-- 4. Utility bills, dated by the service period (accrual). A bill that spans two months is split by
--    days into one part per month; each part posts Dr expense / Cr 2010 dated in its own month.
--    One AP payable (2010) carries the whole bill and is settled when the bill is paid.
CREATE TABLE IF NOT EXISTS utility_bills (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  utility_slug VARCHAR(80) NOT NULL,
  expense_account_code VARCHAR(20) NOT NULL,
  provider VARCHAR(120) NOT NULL,
  account_number VARCHAR(60) NULL,
  service_from DATE NOT NULL,
  service_to DATE NOT NULL,
  reading_value DECIMAL(14,3) NULL,
  reading_unit ENUM('kWh', 'm3', 'kg') NULL,
  amount DECIMAL(14,2) NOT NULL,
  due_date DATE NULL,
  payable_id BIGINT UNSIGNED NULL,
  status ENUM('active', 'voided') NOT NULL DEFAULT 'active',
  notes VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by BIGINT UNSIGNED NULL,
  voided_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_utility_bills_slug_period (utility_slug, service_from, service_to),
  KEY idx_utility_bills_payable (payable_id),
  CONSTRAINT chk_utility_bills_period CHECK (service_to >= service_from),
  CONSTRAINT chk_utility_bills_amount CHECK (amount > 0),
  CONSTRAINT chk_utility_bills_reading CHECK (reading_value IS NULL OR reading_value >= 0),
  CONSTRAINT fk_utility_bills_payable FOREIGN KEY (payable_id) REFERENCES financial_payables (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_utility_bills_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_utility_bills_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS utility_bill_parts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bill_id BIGINT UNSIGNED NOT NULL,
  part_month DATE NOT NULL COMMENT 'First day of the month this part belongs to',
  part_from DATE NOT NULL,
  part_to DATE NOT NULL,
  days SMALLINT UNSIGNED NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  reading_share DECIMAL(14,3) NULL,
  journal_entry_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_utility_bill_parts_bill_month (bill_id, part_month),
  UNIQUE KEY uq_utility_bill_parts_entry (journal_entry_id),
  KEY idx_utility_bill_parts_month (part_month),
  CONSTRAINT fk_utility_bill_parts_bill FOREIGN KEY (bill_id) REFERENCES utility_bills (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_utility_bill_parts_entry FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
