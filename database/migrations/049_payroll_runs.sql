-- Migration 049: Payroll runs and lines (Phase 2 of docs/PAYROLL_IMPLEMENTATION_PLAN.md).
-- A run covers one semi-monthly cut-off. Lines snapshot the employee's pay basis and rate so later
-- rate changes never rewrite past payroll. Approving a run posts one accrual entry and up to three
-- payables (net pay 2040, government contributions 2050, withholding tax 2060). The 13th month
-- accrues to 2045 and is tracked per line until it is paid out in December.

CREATE TABLE IF NOT EXISTS payroll_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pay_date DATE NOT NULL,
  status ENUM('draft', 'approved', 'paid', 'voided') NOT NULL DEFAULT 'draft',
  rate_table_year SMALLINT UNSIGNED NULL,
  total_gross DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_net DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_employee_contributions DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_employer_contributions DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_withholding_tax DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  total_thirteenth_month DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  accrual_journal_entry_id BIGINT UNSIGNED NULL,
  void_journal_entry_id BIGINT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  voided_by BIGINT UNSIGNED NULL,
  voided_at DATETIME NULL,
  void_reason VARCHAR(255) NULL,
  -- One live (non-voided) run per cut-off.
  live_period_key VARCHAR(24) AS (IF(status = 'voided', NULL, CONCAT(period_start, '_', period_end))) PERSISTENT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_runs_live_period (live_period_key),
  KEY idx_payroll_runs_period (period_start, period_end),
  CONSTRAINT chk_payroll_runs_period CHECK (period_end >= period_start),
  CONSTRAINT fk_payroll_runs_accrual_je FOREIGN KEY (accrual_journal_entry_id) REFERENCES journal_entries (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_runs_void_je FOREIGN KEY (void_journal_entry_id) REFERENCES journal_entries (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_runs_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_runs_approved_by FOREIGN KEY (approved_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_payroll_runs_voided_by FOREIGN KEY (voided_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payroll_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NOT NULL,
  employee_id BIGINT UNSIGNED NOT NULL,
  employee_name VARCHAR(120) NOT NULL,
  position VARCHAR(80) NOT NULL,
  pay_basis ENUM('monthly', 'daily', 'hourly') NOT NULL,
  rate DECIMAL(12,2) NOT NULL,
  daily_divisor SMALLINT UNSIGNED NOT NULL,
  days_worked DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  hours_worked DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  days_absent DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  ot_hours DECIMAL(7,2) NOT NULL DEFAULT 0.00,
  prefill_note VARCHAR(160) NULL,
  basic_pay DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ot_pay DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  gross_pay DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  sss_ee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  philhealth_ee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  pagibig_ee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  withholding_tax DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  net_pay DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  sss_er DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ec_er DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  philhealth_er DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  pagibig_er DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  thirteenth_month_accrual DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  proration_note VARCHAR(160) NULL,
  paid_at DATETIME NULL,
  payment_channel ENUM('cash_counter', 'gcash', 'store_bank') NULL,
  payment_journal_entry_id BIGINT UNSIGNED NULL,
  thirteenth_paid_at DATETIME NULL,
  thirteenth_payment_journal_entry_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_lines_run_employee (run_id, employee_id),
  KEY idx_payroll_lines_employee (employee_id),
  CONSTRAINT chk_payroll_lines_inputs CHECK (days_worked >= 0 AND hours_worked >= 0 AND days_absent >= 0 AND ot_hours >= 0),
  CONSTRAINT chk_payroll_lines_net CHECK (net_pay >= 0),
  CONSTRAINT fk_payroll_lines_run FOREIGN KEY (run_id) REFERENCES payroll_runs (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_payroll_lines_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_lines_payment_je FOREIGN KEY (payment_journal_entry_id) REFERENCES journal_entries (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_lines_13th_je FOREIGN KEY (thirteenth_payment_journal_entry_id) REFERENCES journal_entries (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link payables back to their run (payroll / statutory payables).
SET @sql_049 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'financial_payables' AND column_name = 'payroll_run_id') = 0,
  'ALTER TABLE financial_payables ADD COLUMN payroll_run_id BIGINT UNSIGNED NULL AFTER session_id',
  'SELECT 1'
);
PREPARE stmt_049 FROM @sql_049; EXECUTE stmt_049; DEALLOCATE PREPARE stmt_049;

SET @sql_049 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'financial_payables' AND constraint_name = 'fk_fp_payroll_run') = 0,
  'ALTER TABLE financial_payables ADD CONSTRAINT fk_fp_payroll_run FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs (id) ON UPDATE CASCADE ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt_049 FROM @sql_049; EXECUTE stmt_049; DEALLOCATE PREPARE stmt_049;

-- A payroll accrual entry creates several payables, so incurred_journal_entry_id is no longer
-- unique. Replace the unique key with a plain index (the FK still needs an index).
SET @sql_049 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'financial_payables' AND index_name = 'idx_fp_incurred_je') = 0,
  'ALTER TABLE financial_payables ADD KEY idx_fp_incurred_je (incurred_journal_entry_id)',
  'SELECT 1'
);
PREPARE stmt_049 FROM @sql_049; EXECUTE stmt_049; DEALLOCATE PREPARE stmt_049;

SET @sql_049 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'financial_payables' AND index_name = 'uq_fp_incurred_je') > 0,
  'ALTER TABLE financial_payables DROP INDEX uq_fp_incurred_je',
  'SELECT 1'
);
PREPARE stmt_049 FROM @sql_049; EXECUTE stmt_049; DEALLOCATE PREPARE stmt_049;
