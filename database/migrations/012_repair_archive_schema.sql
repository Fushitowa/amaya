USE amaya;

-- Repair migration for databases where the original archive migration was
-- marked applied but one or more archive fields are missing.
-- The operations are idempotent so this can safely reconcile partial schemas.
SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'is_archived') = 0,
  'ALTER TABLE menu_products ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'archived_at') = 0,
  'ALTER TABLE menu_products ADD COLUMN archived_at DATETIME NULL',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'archived_by') = 0,
  'ALTER TABLE menu_products ADD COLUMN archived_by BIGINT UNSIGNED NULL',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND column_name = 'is_archived') = 0,
  'ALTER TABLE inventory_items ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND column_name = 'archived_at') = 0,
  'ALTER TABLE inventory_items ADD COLUMN archived_at DATETIME NULL',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

SET @archive_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND column_name = 'archived_by') = 0,
  'ALTER TABLE inventory_items ADD COLUMN archived_by BIGINT UNSIGNED NULL',
  'SELECT 1'
);
PREPARE archive_stmt FROM @archive_sql;
EXECUTE archive_stmt;
DEALLOCATE PREPARE archive_stmt;

-- Preserve legacy archive timestamps when adding the boolean archive flag.
UPDATE inventory_items
   SET is_archived = TRUE
 WHERE archived_at IS NOT NULL AND is_archived = FALSE;

CREATE TABLE IF NOT EXISTS archive_audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entity_type ENUM('menu_product', 'inventory_item') NOT NULL,
    entity_id BIGINT UNSIGNED NOT NULL,
    entity_name VARCHAR(160) NOT NULL,
    action ENUM('archived', 'restored', 'purged', 'manual_deleted') NOT NULL,
    actor_id BIGINT UNSIGNED NULL,
    actor_name VARCHAR(80) NOT NULL DEFAULT 'System',
    note VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_archive_audit_entity (entity_type, entity_id),
    KEY idx_archive_audit_created (created_at),
    CONSTRAINT fk_archive_audit_actor
        FOREIGN KEY (actor_id) REFERENCES users (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
