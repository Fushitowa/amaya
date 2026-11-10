-- Add optional image attachment support to inventory items (idempotent)
SET @has_image_url = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'inventory_items'
     AND column_name = 'image_url'
);
SET @add_image_url_sql = IF(
  @has_image_url = 0,
  'ALTER TABLE inventory_items ADD COLUMN image_url LONGTEXT NULL AFTER name',
  'SELECT 1'
);
PREPARE add_image_url_stmt FROM @add_image_url_sql;
EXECUTE add_image_url_stmt;
DEALLOCATE PREPARE add_image_url_stmt;
