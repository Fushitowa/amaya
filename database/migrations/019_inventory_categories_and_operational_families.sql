USE amaya;

-- 1. Enhance menu_categories with operational_family
SET @operational_family_sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'menu_categories' AND column_name = 'operational_family') = 0,
  'ALTER TABLE menu_categories ADD COLUMN operational_family ENUM(''drink'', ''fries'', ''snack_pieces'', ''single_fixed'', ''general'') NOT NULL DEFAULT ''general''',
  'SELECT 1'
);
PREPARE operational_family_stmt FROM @operational_family_sql;
EXECUTE operational_family_stmt;
DEALLOCATE PREPARE operational_family_stmt;

-- Backfill operational families for canonical menu categories
UPDATE menu_categories 
   SET operational_family = 'drink' 
 WHERE name COLLATE utf8mb4_unicode_ci IN ('Milktea', 'Float Series', 'Fruity Soda', 'Fruity Milk', 'Iced Coffee')
   AND (operational_family IS NULL OR operational_family = 'general');

UPDATE menu_categories 
   SET operational_family = 'fries' 
 WHERE name COLLATE utf8mb4_unicode_ci = 'Fries & Sip'
   AND (operational_family IS NULL OR operational_family = 'general');

UPDATE menu_categories 
   SET operational_family = 'snack_pieces' 
 WHERE name COLLATE utf8mb4_unicode_ci = 'Foods / Snacks'
   AND (operational_family IS NULL OR operational_family = 'general');

UPDATE menu_categories 
   SET operational_family = 'single_fixed' 
 WHERE name COLLATE utf8mb4_unicode_ci IN ('Burgers and Hotdogs', 'Desserts')
   AND (operational_family IS NULL OR operational_family = 'general');

-- 2. Create inventory_categories table
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

-- 3. Seed canonical inventory categories
INSERT INTO inventory_categories (name, description, is_cup_category, is_system, display_order) VALUES
  ('Cups & Lids', 'Beverage cups, flat lids, dome lids, and sealing films', TRUE, TRUE, 1),
  ('Packaging & Disposables', 'Straws, takeout bags, holders, napkins, and meal wrappers', FALSE, TRUE, 2),
  ('Snack Ingredients & Meats', 'Patties, sausages, fries, cheeses, seasonings, and cooking oils', FALSE, TRUE, 3),
  ('Bakery & Breads', 'Buns, waffles, pastries, and bread items', FALSE, TRUE, 4),
  ('Dairy & Ice Cream', 'Fresh milk, heavy cream, ice cream tubs, and creamer bases', FALSE, TRUE, 5),
  ('Syrups & Purees', 'Fruit purees, flavored syrups, and concentrated liquid bases', FALSE, TRUE, 6),
  ('Powders & Seasonings', 'Tea powders, flavor mixes, cocoa, and matcha blends', FALSE, TRUE, 7),
  ('Toppings & Add-ons', 'Boba pearls, nata de coco, jellies, and popping boba', FALSE, TRUE, 8),
  ('Cooking & Condiments', 'Sauces, mayonnaise, ketchup, mustard, and cooking fats', FALSE, TRUE, 9),
  ('Store & Cleaning Supplies', 'Sanitizers, cleaning agents, gloves, and maintenance items', FALSE, TRUE, 10)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  is_cup_category = VALUES(is_cup_category),
  is_system = VALUES(is_system),
  display_order = VALUES(display_order);

-- 4. Dynamically harvest any distinct categories currently in inventory_items
INSERT IGNORE INTO inventory_categories (name, description, is_cup_category, is_system, display_order)
SELECT DISTINCT category, 'Imported from existing inventory items', (category COLLATE utf8mb4_unicode_ci = 'Cups' OR category COLLATE utf8mb4_unicode_ci = 'Cups & Lids'), FALSE, 99
  FROM inventory_items
 WHERE category IS NOT NULL AND TRIM(category) != ''
   AND category COLLATE utf8mb4_unicode_ci NOT IN (SELECT name COLLATE utf8mb4_unicode_ci FROM inventory_categories);
