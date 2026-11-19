-- Monthly expense budgets tied to the expense categories used by the portal.
CREATE TABLE IF NOT EXISTS expense_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  label VARCHAR(160) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expense_categories_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO expense_categories (slug, label) VALUES
  ('labor-and-payroll', 'Labor and Payroll'),
  ('salary', 'Salary'),
  ('wages', 'Wages'),
  ('overtime', 'Overtime'),
  ('staff-meals', 'Staff Meals'),
  ('utilities', 'Utilities'),
  ('electricity', 'Electricity'),
  ('water', 'Water'),
  ('lpg', 'LPG'),
  ('internet', 'Internet'),
  ('operating-supplies', 'Operating Supplies'),
  ('kitchen-tools', 'Kitchen Tools'),
  ('sanitation-supplies', 'Sanitation Supplies'),
  ('other-operating-supplies', 'Other Operating Supplies'),
  ('repairs-and-maintenance', 'Repairs and Maintenance'),
  ('maintenance-expenses', 'Maintenance Expenses'),
  ('labor-for-repairs', 'Labor for Repairs'),
  ('general-and-administrative', 'General and Administrative'),
  ('office-expenses', 'Office Expenses'),
  ('taxes-and-licenses', 'Taxes and Licenses'),
  ('professional-and-bank-fees', 'Professional and Bank Fees'),
  ('transportation', 'Transportation'),
  ('miscellaneous', 'Miscellaneous')
ON DUPLICATE KEY UPDATE label = VALUES(label);

SET @sql_043 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'journal_entries'
      AND column_name = 'expense_category_id') = 0,
  'ALTER TABLE journal_entries ADD COLUMN expense_category_id BIGINT UNSIGNED NULL AFTER entry_type',
  'SELECT 1'
);
PREPARE stmt_043 FROM @sql_043; EXECUTE stmt_043; DEALLOCATE PREPARE stmt_043;

SET @sql_043 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'journal_entries'
      AND constraint_name = 'fk_journal_entries_expense_category') = 0,
  'ALTER TABLE journal_entries ADD CONSTRAINT fk_journal_entries_expense_category FOREIGN KEY (expense_category_id) REFERENCES expense_categories (id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt_043 FROM @sql_043; EXECUTE stmt_043; DEALLOCATE PREPARE stmt_043;

CREATE TABLE IF NOT EXISTS expense_budgets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id BIGINT UNSIGNED NOT NULL,
  budget_month DATE NOT NULL COMMENT 'First day of the budget month',
  budget_amount DECIMAL(14,2) NOT NULL,
  set_by BIGINT UNSIGNED NOT NULL,
  date_set TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_expense_budgets_category_month (category_id, budget_month),
  KEY idx_expense_budgets_month (budget_month),
  CONSTRAINT fk_expense_budgets_category FOREIGN KEY (category_id) REFERENCES expense_categories (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_expense_budgets_set_by FOREIGN KEY (set_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_expense_budgets_amount CHECK (budget_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
