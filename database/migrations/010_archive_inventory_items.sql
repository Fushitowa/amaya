USE amaya;

-- Keep inventory history by archiving rows. These guarded DDL statements also
-- handle databases where the incoming archive migration already added the
-- archived_at column or where the original unique-name index still exists.
SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND column_name = 'archived_at') = 0,
  'ALTER TABLE inventory_items ADD COLUMN archived_at DATETIME NULL AFTER updated_at',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND column_name = 'active_name') = 0,
  'ALTER TABLE inventory_items ADD COLUMN active_name VARCHAR(160) GENERATED ALWAYS AS (CASE WHEN archived_at IS NULL THEN name ELSE NULL END) STORED',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND index_name = 'uq_inventory_items_name') > 0,
  'ALTER TABLE inventory_items DROP INDEX uq_inventory_items_name',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND index_name = 'uq_inventory_items_active_name') = 0,
  'ALTER TABLE inventory_items ADD UNIQUE KEY uq_inventory_items_active_name (active_name)',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;
