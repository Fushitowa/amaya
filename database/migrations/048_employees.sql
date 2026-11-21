-- Migration 048: Employee master file and pay-rate history (Phase 1 of the payroll plan).
-- Employees are separate from system logins: a POS login can be linked, but crew without a login
-- can still be paid. The owner is never an employee (owner pay is Owner's Drawings).
-- Government ID numbers are stored encrypted by the API (AES-256-GCM), never as plain text.

CREATE TABLE IF NOT EXISTS employees (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL COMMENT 'Optional linked POS login',
  full_name VARCHAR(120) NOT NULL,
  position VARCHAR(80) NOT NULL,
  employment_status ENUM('regular', 'probationary', 'part_time', 'contractual') NOT NULL DEFAULT 'probationary',
  pay_basis ENUM('monthly', 'daily', 'hourly') NOT NULL,
  daily_divisor SMALLINT UNSIGNED NOT NULL DEFAULT 313 COMMENT 'Paid days per year: 313 = 6-day week, 261 = 5-day week, 365 = paid every day',
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('active', 'resigned') NOT NULL DEFAULT 'active',
  sss_no VARCHAR(255) NULL COMMENT 'Encrypted',
  philhealth_no VARCHAR(255) NULL COMMENT 'Encrypted',
  pagibig_no VARCHAR(255) NULL COMMENT 'Encrypted',
  tin VARCHAR(255) NULL COMMENT 'Encrypted',
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_user (user_id),
  KEY idx_employees_status (status, is_archived),
  CONSTRAINT chk_employees_divisor CHECK (daily_divisor IN (261, 313, 365)),
  CONSTRAINT chk_employees_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT chk_employees_resigned CHECK (status = 'active' OR end_date IS NOT NULL),
  CONSTRAINT fk_employees_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_employees_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_employees_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rate history: rows are only ever inserted. The rate in force on a date is the row with the latest
-- effective_from on or before that date (ties broken by the newest id, so a same-day correction wins).
-- `rate` is per month, per day or per hour according to the employee's pay_basis.
CREATE TABLE IF NOT EXISTS employee_pay_rates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  employee_id BIGINT UNSIGNED NOT NULL,
  rate DECIMAL(12,2) NOT NULL,
  effective_from DATE NOT NULL,
  note VARCHAR(160) NULL,
  set_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pay_rates_employee_effective (employee_id, effective_from, id),
  CONSTRAINT chk_pay_rates_rate CHECK (rate > 0),
  CONSTRAINT fk_pay_rates_employee FOREIGN KEY (employee_id) REFERENCES employees (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_pay_rates_set_by FOREIGN KEY (set_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
