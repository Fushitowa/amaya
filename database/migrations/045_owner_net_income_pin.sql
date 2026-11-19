SET @sql_045 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings'
      AND column_name = 'owner_net_income_pin_hash') = 0,
  'ALTER TABLE business_settings ADD COLUMN owner_net_income_pin_hash VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE stmt_045 FROM @sql_045; EXECUTE stmt_045; DEALLOCATE PREPARE stmt_045;

SET @sql_045 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings'
      AND column_name = 'owner_net_income_pin_failed_attempts') = 0,
  'ALTER TABLE business_settings ADD COLUMN owner_net_income_pin_failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt_045 FROM @sql_045; EXECUTE stmt_045; DEALLOCATE PREPARE stmt_045;

SET @sql_045 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings'
      AND column_name = 'owner_net_income_pin_locked_until') = 0,
  'ALTER TABLE business_settings ADD COLUMN owner_net_income_pin_locked_until DATETIME NULL',
  'SELECT 1'
);
PREPARE stmt_045 FROM @sql_045; EXECUTE stmt_045; DEALLOCATE PREPARE stmt_045;
