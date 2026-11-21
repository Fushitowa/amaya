-- Migration 050: Cost targets and payroll settings (Phase 3 P3.1 + Phase 3B O3.8 of
-- docs/PAYROLL_IMPLEMENTATION_PLAN.md).
-- * target_labor_cost       share of net sales the owner aims to spend on labor (default 30%)
-- * target_utilities_cost   share of net sales for utilities (default 5%, USAR benchmark 3–5%)
-- * target_occupancy_cost   share of net sales for rent and occupancy (default 10%)
-- * payroll_frequency       only semi-monthly cut-offs are supported for now
-- * contribution_split      per_cutoff = half of SSS / PhilHealth / Pag-IBIG each cut-off (default),
--                           monthly    = the whole month is deducted in the 2nd cut-off
-- Each payroll run stores the split it was computed with, so changing the setting never rewrites
-- an approved run.

SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'target_labor_cost') = 0,
  'ALTER TABLE business_settings ADD COLUMN target_labor_cost DECIMAL(5,4) NOT NULL DEFAULT 0.3000 AFTER target_food_cost',
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;

SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'target_utilities_cost') = 0,
  'ALTER TABLE business_settings ADD COLUMN target_utilities_cost DECIMAL(5,4) NOT NULL DEFAULT 0.0500 AFTER target_labor_cost',
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;

SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'target_occupancy_cost') = 0,
  'ALTER TABLE business_settings ADD COLUMN target_occupancy_cost DECIMAL(5,4) NOT NULL DEFAULT 0.1000 AFTER target_utilities_cost',
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;

SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'payroll_frequency') = 0,
  "ALTER TABLE business_settings ADD COLUMN payroll_frequency ENUM('semi_monthly') NOT NULL DEFAULT 'semi_monthly' AFTER target_occupancy_cost",
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;

SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'contribution_split') = 0,
  "ALTER TABLE business_settings ADD COLUMN contribution_split ENUM('per_cutoff','monthly') NOT NULL DEFAULT 'per_cutoff' AFTER payroll_frequency",
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;

-- Bounds, like chk_business_settings_target_food_cost (migration 029).
SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'business_settings'
      AND constraint_name = 'chk_business_settings_target_labor_cost') = 0,
  'ALTER TABLE business_settings ADD CONSTRAINT chk_business_settings_target_labor_cost CHECK (target_labor_cost >= 0.0500 AND target_labor_cost <= 0.6000)',
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;

SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'business_settings'
      AND constraint_name = 'chk_business_settings_target_utilities_cost') = 0,
  'ALTER TABLE business_settings ADD CONSTRAINT chk_business_settings_target_utilities_cost CHECK (target_utilities_cost >= 0.0100 AND target_utilities_cost <= 0.3000)',
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;

SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'business_settings'
      AND constraint_name = 'chk_business_settings_target_occupancy_cost') = 0,
  'ALTER TABLE business_settings ADD CONSTRAINT chk_business_settings_target_occupancy_cost CHECK (target_occupancy_cost >= 0.0100 AND target_occupancy_cost <= 0.4000)',
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;

-- The split each run was computed with.
SET @sql_050 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'payroll_runs' AND column_name = 'contribution_split') = 0,
  "ALTER TABLE payroll_runs ADD COLUMN contribution_split ENUM('per_cutoff','monthly') NOT NULL DEFAULT 'per_cutoff' AFTER rate_table_year",
  'SELECT 1'
);
PREPARE stmt_050 FROM @sql_050; EXECUTE stmt_050; DEALLOCATE PREPARE stmt_050;
