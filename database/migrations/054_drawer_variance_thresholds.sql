-- Migration 054: Cash drawer over/short limits.
-- * drawer_variance_ok      a shift's drawer difference up to this many pesos is normal change-making
-- * drawer_variance_review  above this the owner should look at the shift the same day
-- Used to label closed shifts and to spot repeat problems by cashier and weekday. These limits only
-- flag shifts for review; nothing here is ever deducted from anyone's pay.

SET @sql_054 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'drawer_variance_ok') = 0,
  'ALTER TABLE business_settings ADD COLUMN drawer_variance_ok DECIMAL(10,2) NOT NULL DEFAULT 50.00',
  'SELECT 1'
);
PREPARE stmt_054 FROM @sql_054; EXECUTE stmt_054; DEALLOCATE PREPARE stmt_054;

SET @sql_054 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'drawer_variance_review') = 0,
  'ALTER TABLE business_settings ADD COLUMN drawer_variance_review DECIMAL(10,2) NOT NULL DEFAULT 200.00',
  'SELECT 1'
);
PREPARE stmt_054 FROM @sql_054; EXECUTE stmt_054; DEALLOCATE PREPARE stmt_054;
