USE amaya;

-- Restore the dynamic inventory category table when migration 019 was skipped.
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

INSERT IGNORE INTO inventory_categories (name, description, is_cup_category, is_system, display_order)
SELECT DISTINCT category, 'Imported from existing inventory items', (category IN ('Cups', 'Cups & Lids')), FALSE, 99
  FROM inventory_items
 WHERE category IS NOT NULL AND TRIM(category) <> ''
   AND category COLLATE utf8mb4_unicode_ci NOT IN (SELECT name COLLATE utf8mb4_unicode_ci FROM inventory_categories);

