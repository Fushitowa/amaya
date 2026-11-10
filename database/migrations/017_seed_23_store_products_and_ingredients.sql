USE amaya;

-- The product seed below uses three catalog fields that were not present in the
-- original menu_products schema. Add them conditionally so this migration can
-- run against both older databases and databases where the fields already exist.
SET @product_type_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'product_type') = 0,
  'ALTER TABLE menu_products ADD COLUMN product_type VARCHAR(40) NOT NULL DEFAULT ''recipe_fixed''',
  'SELECT 1'
);
PREPARE product_type_stmt FROM @product_type_sql;
EXECUTE product_type_stmt;
DEALLOCATE PREPARE product_type_stmt;

SET @packaging_size_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'packaging_size') = 0,
  'ALTER TABLE menu_products ADD COLUMN packaging_size VARCHAR(80) NULL',
  'SELECT 1'
);
PREPARE packaging_size_stmt FROM @packaging_size_sql;
EXECUTE packaging_size_stmt;
DEALLOCATE PREPARE packaging_size_stmt;

SET @cost_price_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND column_name = 'cost_price') = 0,
  'ALTER TABLE menu_products ADD COLUMN cost_price DECIMAL(10,2) NOT NULL DEFAULT 0.00',
  'SELECT 1'
);
PREPARE cost_price_stmt FROM @cost_price_sql;
EXECUTE cost_price_stmt;
DEALLOCATE PREPARE cost_price_stmt;

-- ============================================================================
-- NOTE: ALL SYNTHETIC SEED INSERTS INTO inventory_items, menu_products,
-- product_sizes, AND product_addons HAVE BEEN STRIPPED.
-- MARKIE'S MANUAL CATALOG IS 100% PRESERVED. NO SYNTHETIC PRODUCTS ALLOWED.
-- ============================================================================
