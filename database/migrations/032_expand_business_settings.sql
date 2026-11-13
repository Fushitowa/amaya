-- Migration 032: Expand business_settings with operational rules, POS tax/discount policies,
-- standby notification preferences, and orders discount/tax breakdown columns.

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'is_temporarily_closed') = 0,
  'ALTER TABLE business_settings ADD COLUMN is_temporarily_closed BOOLEAN NOT NULL DEFAULT FALSE AFTER closing_time',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'low_stock_threshold_pct') = 0,
  'ALTER TABLE business_settings ADD COLUMN low_stock_threshold_pct INT NOT NULL DEFAULT 40 AFTER target_food_cost',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'critical_stock_threshold_pct') = 0,
  'ALTER TABLE business_settings ADD COLUMN critical_stock_threshold_pct INT NOT NULL DEFAULT 20 AFTER low_stock_threshold_pct',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'inactivity_alert_days') = 0,
  'ALTER TABLE business_settings ADD COLUMN inactivity_alert_days INT NOT NULL DEFAULT 30 AFTER critical_stock_threshold_pct',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'archive_retention_days') = 0,
  'ALTER TABLE business_settings ADD COLUMN archive_retention_days INT NOT NULL DEFAULT 30 AFTER inactivity_alert_days',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'max_inventory_adjustment_pct') = 0,
  'ALTER TABLE business_settings ADD COLUMN max_inventory_adjustment_pct INT NOT NULL DEFAULT 200 AFTER archive_retention_days',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'vat_enabled') = 0,
  'ALTER TABLE business_settings ADD COLUMN vat_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER max_inventory_adjustment_pct',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'vat_rate_pct') = 0,
  'ALTER TABLE business_settings ADD COLUMN vat_rate_pct DECIMAL(5,2) NOT NULL DEFAULT 12.00 AFTER vat_enabled',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'discount_presets_json') = 0,
  'ALTER TABLE business_settings ADD COLUMN discount_presets_json TEXT NULL AFTER vat_rate_pct',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'enforce_shift_gate') = 0,
  'ALTER TABLE business_settings ADD COLUMN enforce_shift_gate BOOLEAN NOT NULL DEFAULT FALSE AFTER discount_presets_json',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'auto_print_receipt') = 0,
  'ALTER TABLE business_settings ADD COLUMN auto_print_receipt BOOLEAN NOT NULL DEFAULT TRUE AFTER enforce_shift_gate',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'default_void_stock_action') = 0,
  'ALTER TABLE business_settings ADD COLUMN default_void_stock_action VARCHAR(16) NOT NULL DEFAULT ''restore'' AFTER auto_print_receipt',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'require_kitchen_note_approval') = 0,
  'ALTER TABLE business_settings ADD COLUMN require_kitchen_note_approval BOOLEAN NOT NULL DEFAULT FALSE AFTER default_void_stock_action',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'idle_lock_minutes') = 0,
  'ALTER TABLE business_settings ADD COLUMN idle_lock_minutes INT NOT NULL DEFAULT 15 AFTER require_kitchen_note_approval',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'receipt_footer') = 0,
  'ALTER TABLE business_settings ADD COLUMN receipt_footer VARCHAR(255) NULL DEFAULT ''Thank you for supporting local craft!'' AFTER idle_lock_minutes',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'export_row_limit') = 0,
  'ALTER TABLE business_settings ADD COLUMN export_row_limit INT NOT NULL DEFAULT 5000 AFTER receipt_footer',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'notify_all_enabled') = 0,
  'ALTER TABLE business_settings ADD COLUMN notify_all_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER export_row_limit',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'notify_order_alerts') = 0,
  'ALTER TABLE business_settings ADD COLUMN notify_order_alerts BOOLEAN NOT NULL DEFAULT TRUE AFTER notify_all_enabled',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'business_settings' AND column_name = 'notify_inventory_alerts') = 0,
  'ALTER TABLE business_settings ADD COLUMN notify_inventory_alerts BOOLEAN NOT NULL DEFAULT TRUE AFTER notify_order_alerts',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

UPDATE business_settings
   SET discount_presets_json = '[{"label":"Senior Citizen (20%)","pct":20},{"label":"PWD (20%)","pct":20},{"label":"Student (10%)","pct":10}]'
 WHERE id = 1 AND (discount_presets_json IS NULL OR TRIM(discount_presets_json) = '');

-- Expand orders with discount/tax columns if missing
SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'discount_amount') = 0,
  'ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER subtotal',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'discount_label') = 0,
  'ALTER TABLE orders ADD COLUMN discount_label VARCHAR(80) NULL AFTER discount_amount',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;

SET @sql_032 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'tax_amount') = 0,
  'ALTER TABLE orders ADD COLUMN tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER discount_label',
  'SELECT 1'
);
PREPARE stmt_032 FROM @sql_032; EXECUTE stmt_032; DEALLOCATE PREPARE stmt_032;
