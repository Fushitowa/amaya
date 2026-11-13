-- Migration 031: Financial Ledger Idempotency, Double-Reversal Prevention & Order Tax/Discount Columns Guard

-- 1. Prevent double-reversal on journal_entries (reverses_entry_id is NULL on non-reversals; MariaDB allows multiple NULLs in UNIQUE)
SET @sql_031 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'journal_entries' AND index_name = 'uq_je_reverses_entry_id') = 0,
  'ALTER TABLE journal_entries ADD UNIQUE KEY uq_je_reverses_entry_id (reverses_entry_id)',
  'SELECT 1'
);
PREPARE stmt_031 FROM @sql_031; EXECUTE stmt_031; DEALLOCATE PREPARE stmt_031;

-- 2. Add idempotency_key column & unique key to prevent duplicate automated ledger entries across retries/concurrency
SET @sql_031 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'journal_entries' AND column_name = 'idempotency_key') = 0,
  'ALTER TABLE journal_entries ADD COLUMN idempotency_key VARCHAR(96) NULL AFTER session_id',
  'SELECT 1'
);
PREPARE stmt_031 FROM @sql_031; EXECUTE stmt_031; DEALLOCATE PREPARE stmt_031;

SET @sql_031 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'journal_entries' AND index_name = 'uq_je_idempotency_key') = 0,
  'ALTER TABLE journal_entries ADD UNIQUE KEY uq_je_idempotency_key (idempotency_key)',
  'SELECT 1'
);
PREPARE stmt_031 FROM @sql_031; EXECUTE stmt_031; DEALLOCATE PREPARE stmt_031;

-- 3. Composite lookup indexes for fast order & inventory movement reconciliation
SET @sql_031 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'journal_entries' AND index_name = 'idx_je_order_type') = 0,
  'ALTER TABLE journal_entries ADD KEY idx_je_order_type (order_id, entry_type)',
  'SELECT 1'
);
PREPARE stmt_031 FROM @sql_031; EXECUTE stmt_031; DEALLOCATE PREPARE stmt_031;

SET @sql_031 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'journal_entries' AND index_name = 'idx_je_movement_type') = 0,
  'ALTER TABLE journal_entries ADD KEY idx_je_movement_type (inventory_movement_id, entry_type)',
  'SELECT 1'
);
PREPARE stmt_031 FROM @sql_031; EXECUTE stmt_031; DEALLOCATE PREPARE stmt_031;
