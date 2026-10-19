USE amaya;

-- 1. Add Soft-Delete / Archive columns to menu_products
ALTER TABLE menu_products
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL,
    ADD COLUMN IF NOT EXISTS archived_by BIGINT UNSIGNED NULL;

-- 2. Add Soft-Delete / Archive columns to inventory_items
ALTER TABLE inventory_items
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL,
    ADD COLUMN IF NOT EXISTS archived_by BIGINT UNSIGNED NULL;

-- 3. Dedicated Permanent Audit Log Table for Archive, Restore, and Purge events
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
