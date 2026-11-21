-- Migration 055: Money that never reached the books.
-- * journal_entries.entry_type gains 'equipment_purchase' (buying equipment after day one: Dr 1510, Cr cash/GCash/bank)
-- * cashier_sessions keeps what the books said was in the drawer when the shift opened, the
--   difference from the counted opening float, and the cashier's reason for it.
-- Paying VAT to BIR needs no schema change: it is an ap_settlement entry (Dr 2020, Cr cash/GCash/bank).

ALTER TABLE journal_entries
  MODIFY COLUMN entry_type ENUM(
    'opening_balance','sales_revenue','cogs_consumption','inventory_restock','operating_expense',
    'capital_injection','owner_withdrawal','account_transfer','void_reversal','adjustment',
    'ap_settlement','depreciation','income_tax','equipment_purchase'
  ) NOT NULL;

SET @sql_055 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'cashier_sessions' AND column_name = 'opening_book_cash') = 0,
  'ALTER TABLE cashier_sessions ADD COLUMN opening_book_cash DECIMAL(14,2) NULL AFTER opening_float',
  'SELECT 1'
);
PREPARE stmt_055 FROM @sql_055; EXECUTE stmt_055; DEALLOCATE PREPARE stmt_055;

SET @sql_055 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'cashier_sessions' AND column_name = 'opening_variance') = 0,
  'ALTER TABLE cashier_sessions ADD COLUMN opening_variance DECIMAL(14,2) NULL AFTER opening_book_cash',
  'SELECT 1'
);
PREPARE stmt_055 FROM @sql_055; EXECUTE stmt_055; DEALLOCATE PREPARE stmt_055;

SET @sql_055 = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'cashier_sessions' AND column_name = 'opening_note') = 0,
  'ALTER TABLE cashier_sessions ADD COLUMN opening_note VARCHAR(255) NULL AFTER opening_variance',
  'SELECT 1'
);
PREPARE stmt_055 FROM @sql_055; EXECUTE stmt_055; DEALLOCATE PREPARE stmt_055;
