USE amaya;

-- 1. Ensure inventory_categories table exists with dynamic defaults
CREATE TABLE IF NOT EXISTS inventory_categories (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500) NULL,
    is_cup_category BOOLEAN NOT NULL DEFAULT FALSE,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Modify is_system to default to FALSE and remove protection
ALTER TABLE inventory_categories MODIFY COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE inventory_categories SET is_system = FALSE WHERE is_system = TRUE;

-- 3. Ensure archive_audit_logs columns support system vault actions
ALTER TABLE archive_audit_logs 
  MODIFY COLUMN entity_type VARCHAR(64) NOT NULL,
  MODIFY COLUMN action VARCHAR(64) NOT NULL;
