-- Migration 033: Allow multiple partial item-revert reversals referencing the same original order journal entry
-- Keeps fk_je_reverses indexed via idx_je_reverses_entry_id while dropping the 1-to-1 unique constraint uq_je_reverses_entry_id.

SET @sql_033 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'journal_entries' AND index_name = 'idx_je_reverses_entry_id') = 0,
  'ALTER TABLE journal_entries ADD KEY idx_je_reverses_entry_id (reverses_entry_id)',
  'SELECT 1'
);
PREPARE stmt_033 FROM @sql_033; EXECUTE stmt_033; DEALLOCATE PREPARE stmt_033;

SET @sql_033 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'journal_entries' AND index_name = 'uq_je_reverses_entry_id') > 0,
  'ALTER TABLE journal_entries DROP INDEX uq_je_reverses_entry_id',
  'SELECT 1'
);
PREPARE stmt_033 FROM @sql_033; EXECUTE stmt_033; DEALLOCATE PREPARE stmt_033;
