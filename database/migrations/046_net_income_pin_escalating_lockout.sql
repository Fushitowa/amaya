-- Count consecutive Net Income PIN lockouts so each new lockout lasts longer
-- (5 minutes, then 1 hour, then 24 hours). Reset to 0 after a correct PIN.
SET @sql_046 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings'
      AND column_name = 'owner_net_income_pin_lockouts') = 0,
  'ALTER TABLE business_settings ADD COLUMN owner_net_income_pin_lockouts TINYINT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt_046 FROM @sql_046; EXECUTE stmt_046; DEALLOCATE PREPARE stmt_046;
