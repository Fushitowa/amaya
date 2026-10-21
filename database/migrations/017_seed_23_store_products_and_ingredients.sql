USE amaya;

-- ============================================================================
-- 1. SEED & RESTOCK ESSENTIAL WHOLESALE INVENTORY ITEMS
-- ============================================================================
INSERT INTO inventory_items (name, category, unit, quantity, maximum_stock, purchase_price, package_quantity, package_unit, contents_per_package, unit_cost, is_archived, archived_at)
VALUES
  ('French Fries (Shoestring)', 'Snack Ingredients & Meats', 'g', 10000.000, 20000.000, 210.00, 1.000, 'pack', 2000.000, 0.105000, FALSE, NULL),
  ('Cooking Oil (Palm)', 'Cooking & Condiments', 'ml', 17000.000, 34000.000, 1250.00, 1.000, 'tin', 17000.000, 0.073529, FALSE, NULL),
  ('Cheese Seasoning Powder', 'Powders & Seasonings', 'g', 1000.000, 3000.000, 245.00, 1.000, 'pack', 1000.000, 0.245000, FALSE, NULL),
  ('BBQ Seasoning Powder', 'Powders & Seasonings', 'g', 1000.000, 3000.000, 245.00, 1.000, 'pack', 1000.000, 0.245000, FALSE, NULL),
  ('Sour Cream Seasoning Powder', 'Powders & Seasonings', 'g', 1000.000, 3000.000, 250.00, 1.000, 'pack', 1000.000, 0.250000, FALSE, NULL),
  ('Street Food Tempura', 'Snack Ingredients & Meats', 'pcs', 200.000, 500.000, 145.00, 1.000, 'pack', 45.000, 3.222200, FALSE, NULL),
  ('Street Food Fishballs', 'Snack Ingredients & Meats', 'pcs', 500.000, 1000.000, 85.00, 1.000, 'pack', 100.000, 0.850000, FALSE, NULL),
  ('Pork Siomai', 'Snack Ingredients & Meats', 'pcs', 180.000, 300.000, 180.00, 1.000, 'pack', 60.000, 3.000000, FALSE, NULL),
  ('Pork Lumpiang Shanghai', 'Snack Ingredients & Meats', 'pcs', 150.000, 300.000, 140.00, 1.000, 'pack', 50.000, 2.800000, FALSE, NULL),
  ('Sweet Chili Sauce', 'Cooking & Condiments', 'ml', 3785.000, 7570.000, 185.00, 1.000, 'gallon', 3785.000, 0.048877, FALSE, NULL),
  ('Chili Garlic Paste', 'Cooking & Condiments', 'g', 1000.000, 2000.000, 180.00, 1.000, 'tub', 1000.000, 0.180000, FALSE, NULL),
  ('Takoyaki Premix Flour', 'Powders & Seasonings', 'g', 3000.000, 6000.000, 85.00, 1.000, 'pack', 1000.000, 0.085000, FALSE, NULL),
  ('Takoyaki Sauce', 'Cooking & Condiments', 'ml', 2000.000, 4000.000, 190.00, 1.000, 'bottle', 1000.000, 0.190000, FALSE, NULL),
  ('Japanese Mayonnaise', 'Cooking & Condiments', 'g', 2000.000, 4000.000, 340.00, 1.000, 'pouch', 1000.000, 0.340000, FALSE, NULL),
  ('Bonito Flakes (Katsuobushi)', 'Toppings & Add-ons', 'g', 500.000, 1000.000, 550.00, 1.000, 'pack', 500.000, 1.100000, FALSE, NULL),
  ('Burger Patties (Beef)', 'Snack Ingredients & Meats', 'pcs', 64.000, 128.000, 165.00, 1.000, 'pack', 32.000, 5.156250, FALSE, NULL),
  ('Burger Buns', 'Bakery & Breads', 'pcs', 72.000, 144.000, 72.00, 1.000, 'pack', 24.000, 3.000000, FALSE, NULL),
  ('Jumbo Hotdogs', 'Snack Ingredients & Meats', 'pcs', 36.000, 72.000, 160.00, 1.000, 'pack', 12.000, 13.333333, FALSE, NULL),
  ('Hotdog Buns', 'Bakery & Breads', 'pcs', 30.000, 60.000, 35.00, 1.000, 'pack', 10.000, 3.500000, FALSE, NULL),
  ('Graham Crackers', 'Bakery & Breads', 'g', 2000.000, 5000.000, 175.00, 1.000, 'pack', 1000.000, 0.175000, FALSE, NULL),
  ('All-Purpose Cream', 'Dairy & Ice Cream', 'ml', 3000.000, 6000.000, 45.00, 1.000, 'pack', 250.000, 0.180000, FALSE, NULL),
  ('Condensed Milk', 'Dairy & Ice Cream', 'g', 3040.000, 6080.000, 65.00, 1.000, 'can', 380.000, 0.171053, FALSE, NULL),
  ('Ripe Carabao Mangoes', 'Syrups & Purees', 'g', 3000.000, 8000.000, 85.00, 1.000, 'kg', 1000.000, 0.085000, FALSE, NULL),
  ('500ml Dessert Tub with Lid', 'Packaging & Disposables', 'pcs', 50.000, 150.000, 225.00, 1.000, 'pack', 50.000, 4.500000, FALSE, NULL),
  ('Taro Powder', 'Powders & Seasonings', 'g', 1500.000, 3000.000, 115.00, 1.000, 'pack', 500.000, 0.230000, FALSE, NULL),
  ('Cookies and Cream Powder', 'Powders & Seasonings', 'g', 1500.000, 3000.000, 115.00, 1.000, 'pack', 500.000, 0.230000, FALSE, NULL),
  ('Chocolate Powder', 'Powders & Seasonings', 'g', 1500.000, 3000.000, 115.00, 1.000, 'pack', 500.000, 0.230000, FALSE, NULL),
  ('Coca-Cola', 'Syrups & Purees', 'ml', 9000.000, 18000.000, 70.00, 1.000, 'bottle', 1500.000, 0.046667, FALSE, NULL),
  ('Vanilla Ice Cream', 'Dairy & Ice Cream', 'g', 3785.000, 7570.000, 390.00, 1.000, 'gallon', 3785.000, 0.103038, FALSE, NULL),
  ('Blueberry Fruit Syrup', 'Syrups & Purees', 'ml', 1500.000, 3000.000, 225.00, 1.000, 'bottle', 750.000, 0.300000, FALSE, NULL),
  ('Green Apple Fruit Syrup', 'Syrups & Purees', 'ml', 1500.000, 3000.000, 260.00, 1.000, 'bottle', 750.000, 0.346667, FALSE, NULL),
  ('Strawberry Fruit Syrup', 'Syrups & Purees', 'ml', 1500.000, 3000.000, 240.00, 1.000, 'bottle', 750.000, 0.320000, FALSE, NULL),
  ('Mango Fruit Puree', 'Syrups & Purees', 'ml', 1500.000, 3000.000, 240.00, 1.000, 'bottle', 750.000, 0.320000, FALSE, NULL),
  ('Fresh Milk (UHT)', 'Dairy & Ice Cream', 'ml', 6000.000, 12000.000, 88.00, 1.000, 'liter', 1000.000, 0.088000, FALSE, NULL),
  ('Matcha Powder', 'Powders & Seasonings', 'g', 500.000, 1500.000, 200.00, 1.000, 'pack', 500.000, 0.400000, FALSE, NULL),
  ('Caramel Syrup', 'Syrups & Purees', 'ml', 750.000, 2250.000, 250.00, 1.000, 'bottle', 750.000, 0.333333, FALSE, NULL),
  ('Espresso Coffee Beans', 'Powders & Seasonings', 'g', 1000.000, 3000.000, 380.00, 1.000, 'pack', 1000.000, 0.380000, FALSE, NULL),
  ('Sparkling Soda Water', 'Syrups & Purees', 'ml', 9000.000, 18000.000, 68.00, 1.000, 'bottle', 1500.000, 0.045333, FALSE, NULL),
  ('8oz PP Cup (95mm)', 'Cups & Lids', 'pcs', 500.000, 1000.000, 110.00, 1.000, 'pack', 100.000, 1.100000, FALSE, NULL),
  ('12oz PP Cup (95mm)', 'Cups & Lids', 'pcs', 500.000, 1000.000, 125.00, 1.000, 'pack', 100.000, 1.250000, FALSE, NULL),
  ('95mm Flat Lid', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 80.00, 1.000, 'pack', 100.000, 0.800000, FALSE, NULL),
  ('95mm Dome Lid', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 95.00, 1.000, 'pack', 100.000, 0.950000, FALSE, NULL),
  ('Regular Wrapped Straw', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 38.00, 1.000, 'pack', 100.000, 0.380000, FALSE, NULL),
  ('Boba Straw (12mm)', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 60.00, 1.000, 'pack', 100.000, 0.600000, FALSE, NULL)
ON DUPLICATE KEY UPDATE
  category = VALUES(category),
  unit = VALUES(unit),
  quantity = VALUES(quantity),
  maximum_stock = VALUES(maximum_stock),
  purchase_price = VALUES(purchase_price),
  package_quantity = VALUES(package_quantity),
  package_unit = VALUES(package_unit),
  contents_per_package = VALUES(contents_per_package),
  unit_cost = VALUES(unit_cost),
  is_archived = FALSE,
  archived_at = NULL;

-- ============================================================================
-- 2. PRESERVE PRODUCT 4 & ENSURE IDEMPOTENT UNIQUE INDEX ON menu_products(name)
-- ============================================================================
UPDATE menu_products
SET name = 'Classic Milktea',
    category_id = 1,
    product_type = 'recipe_fixed',
    packaging_size = '12oz',
    description = 'Signature freshly brewed black tea with rich creamer and brown sugar pearls',
    base_price = 39.00,
    cost_price = 14.73,
    stock_quantity = 50,
    is_available = TRUE,
    is_featured = TRUE,
    display_order = 4
WHERE id = 4;

SET @idx_sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'menu_products' AND index_name = 'uq_menu_products_name') = 0,
  'ALTER TABLE menu_products ADD UNIQUE KEY uq_menu_products_name (name)',
  'SELECT 1'
);
PREPARE idx_stmt FROM @idx_sql;
EXECUTE idx_stmt;
DEALLOCATE PREPARE idx_stmt;

-- ============================================================================
-- 3. INSERT OR UPDATE 23 PHYSICAL STORE PRODUCTS
-- ============================================================================
INSERT INTO menu_products (category_id, product_type, name, description, base_price, cost_price, packaging_size, stock_quantity, is_available, is_featured, display_order)
VALUES
  (3, 'recipe_multisize', 'French Fries', 'Crispy shoestring fries tossed in your choice of Cheese, BBQ, or Sour Cream flavor.', 25.00, 10.82, NULL, 50, TRUE, TRUE, 1),
  (3, 'recipe_fixed', 'Tempura', '4 pcs crispy street tempura with savory manong sauce', 20.00, 15.36, '4 pcs', 50, TRUE, FALSE, 2),
  (3, 'recipe_fixed', 'Fishball', '16 pcs golden street fishballs with signature sauce', 20.00, 16.56, '16 pcs', 50, TRUE, FALSE, 3),
  (3, 'recipe_fixed', 'Siomai', '4 pcs steamed pork siomai with chili garlic and toyomansi', 20.00, 14.69, '4 pcs', 45, TRUE, FALSE, 4),
  (3, 'recipe_fixed', 'Lumpia', '4 pcs crispy fried lumpiang shanghai with sweet chili dip', 20.00, 13.91, '4 pcs', 35, TRUE, FALSE, 5),
  (3, 'recipe_multisize', 'Takoyaki', 'Japanese octopus street balls with savory sauce, mayo & bonito', 30.00, 18.46, NULL, 40, TRUE, TRUE, 6),
  (5, 'recipe_combo', 'Fries & Sip', 'Flavored fries paired with refreshing drink. Flavors: BBQ, Cheese, Sour Cream', 35.00, 15.94, 'Combo', 50, TRUE, TRUE, 1),
  (6, 'recipe_fixed', 'Burger (Buy 1 Take 1)', 'Double burger special! 2 savory beef patties on toasted buns with dressing', 55.00, 20.29, '2 Burgers', 32, TRUE, TRUE, 1),
  (6, 'recipe_fixed', 'Hotdog Bun', 'Juicy jumbo hotdog in warm bun topped with ketchup and mayo', 45.00, 21.33, 'Regular', 30, TRUE, FALSE, 2),
  (4, 'recipe_fixed', 'Mango Graham Float', '500ml chilled dessert tub layered with sweet mangoes, graham & cream', 95.00, 63.20, '500ml tub', 25, TRUE, TRUE, 1),
  (1, 'recipe_fixed', 'Taro Milktea', 'Rich nutty taro infused with creamy milk tea and pearls', 39.00, 14.73, '12oz', 40, TRUE, FALSE, 1),
  (1, 'recipe_fixed', 'Cookies and Cream Milktea', 'Creamy milk tea blended with crushed cookies and chewy boba', 39.00, 14.73, '12oz', 40, TRUE, FALSE, 2),
  (1, 'recipe_fixed', 'Chocolate Milktea', 'Deep decadent chocolate milk tea with black pearls', 39.00, 14.73, '12oz', 40, TRUE, FALSE, 3),
  (1, 'recipe_fixed', 'Classic Milktea', 'Signature freshly brewed black tea with rich creamer and brown sugar pearls', 39.00, 14.73, '12oz', 50, TRUE, TRUE, 4),
  (2, 'recipe_multisize', 'Coke Float', 'Sparkling Coca-Cola crowned with soft vanilla ice cream and choco drizzle', 25.00, 13.92, NULL, 45, TRUE, TRUE, 1),
  (2, 'recipe_multisize', 'Choco Float', 'Ice cold chocolate cooler topped with creamy ice cream and chocolate swirl', 25.00, 10.92, NULL, 45, TRUE, FALSE, 2),
  (7, 'recipe_multisize', 'Blueberry Soda', 'Effervescent sparkling cooler infused with sweet wild blueberry syrup', 25.00, 14.53, NULL, 40, TRUE, FALSE, 1),
  (7, 'recipe_multisize', 'Green Apple Soda', 'Crisp, tangy green apple sparkling soda served over ice', 25.00, 14.53, NULL, 40, TRUE, FALSE, 2),
  (7, 'recipe_multisize', 'Strawberry Soda', 'Refreshing sparkling fruit soda bursting with sweet strawberry flavor', 25.00, 14.53, NULL, 40, TRUE, TRUE, 3),
  (8, 'recipe_multisize', 'Strawberry Milk', 'Smooth, silky fresh milk swirled with luscious strawberry puree', 30.00, 20.03, NULL, 35, TRUE, TRUE, 1),
  (8, 'recipe_multisize', 'Mango Milk', 'Rich fresh milk blended with ripe golden mango puree', 30.00, 20.03, NULL, 35, TRUE, FALSE, 2),
  (9, 'recipe_fixed', 'Matcha Iced Coffee', 'Earthy premium Japanese matcha layered over cold brewed espresso and fresh milk', 39.00, 26.97, '12oz', 30, TRUE, TRUE, 1),
  (9, 'recipe_fixed', 'Caramel Iced Coffee', 'Bold chilled espresso with buttery caramel swirl and fresh milk', 39.00, 30.50, '12oz', 30, TRUE, FALSE, 2)
ON DUPLICATE KEY UPDATE
  category_id = VALUES(category_id),
  product_type = VALUES(product_type),
  description = VALUES(description),
  base_price = VALUES(base_price),
  cost_price = VALUES(cost_price),
  packaging_size = VALUES(packaging_size),
  stock_quantity = VALUES(stock_quantity),
  is_available = VALUES(is_available),
  is_featured = VALUES(is_featured),
  display_order = VALUES(display_order);

-- ============================================================================
-- 4. INSERT OR UPDATE PRODUCT SIZES
-- ============================================================================
-- French Fries
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, 'Regular', 25.00, 1 FROM menu_products p WHERE p.name = 'French Fries'
ON DUPLICATE KEY UPDATE price = 25.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, 'Medium', 50.00, 2 FROM menu_products p WHERE p.name = 'French Fries'
ON DUPLICATE KEY UPDATE price = 50.00, display_order = 2;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, 'Large', 100.00, 3 FROM menu_products p WHERE p.name = 'French Fries'
ON DUPLICATE KEY UPDATE price = 100.00, display_order = 3;

-- Takoyaki
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '4 pcs', 30.00, 1 FROM menu_products p WHERE p.name = 'Takoyaki'
ON DUPLICATE KEY UPDATE price = 30.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '6 pcs', 50.00, 2 FROM menu_products p WHERE p.name = 'Takoyaki'
ON DUPLICATE KEY UPDATE price = 50.00, display_order = 2;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12 pcs', 100.00, 3 FROM menu_products p WHERE p.name = 'Takoyaki'
ON DUPLICATE KEY UPDATE price = 100.00, display_order = 3;

-- Coke Float
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '8oz', 25.00, 1 FROM menu_products p WHERE p.name = 'Coke Float'
ON DUPLICATE KEY UPDATE price = 25.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 35.00, 2 FROM menu_products p WHERE p.name = 'Coke Float'
ON DUPLICATE KEY UPDATE price = 35.00, display_order = 2;

-- Choco Float
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '8oz', 25.00, 1 FROM menu_products p WHERE p.name = 'Choco Float'
ON DUPLICATE KEY UPDATE price = 25.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 35.00, 2 FROM menu_products p WHERE p.name = 'Choco Float'
ON DUPLICATE KEY UPDATE price = 35.00, display_order = 2;

-- Blueberry Soda
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '8oz', 25.00, 1 FROM menu_products p WHERE p.name = 'Blueberry Soda'
ON DUPLICATE KEY UPDATE price = 25.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 35.00, 2 FROM menu_products p WHERE p.name = 'Blueberry Soda'
ON DUPLICATE KEY UPDATE price = 35.00, display_order = 2;

-- Green Apple Soda
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '8oz', 25.00, 1 FROM menu_products p WHERE p.name = 'Green Apple Soda'
ON DUPLICATE KEY UPDATE price = 25.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 35.00, 2 FROM menu_products p WHERE p.name = 'Green Apple Soda'
ON DUPLICATE KEY UPDATE price = 35.00, display_order = 2;

-- Strawberry Soda
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '8oz', 25.00, 1 FROM menu_products p WHERE p.name = 'Strawberry Soda'
ON DUPLICATE KEY UPDATE price = 25.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 35.00, 2 FROM menu_products p WHERE p.name = 'Strawberry Soda'
ON DUPLICATE KEY UPDATE price = 35.00, display_order = 2;

-- Strawberry Milk
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '8oz', 30.00, 1 FROM menu_products p WHERE p.name = 'Strawberry Milk'
ON DUPLICATE KEY UPDATE price = 30.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 40.00, 2 FROM menu_products p WHERE p.name = 'Strawberry Milk'
ON DUPLICATE KEY UPDATE price = 40.00, display_order = 2;

-- Mango Milk
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '8oz', 30.00, 1 FROM menu_products p WHERE p.name = 'Mango Milk'
ON DUPLICATE KEY UPDATE price = 30.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 40.00, 2 FROM menu_products p WHERE p.name = 'Mango Milk'
ON DUPLICATE KEY UPDATE price = 40.00, display_order = 2;

-- Fixed-Recipe Products Default Sizes
INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '4 pcs', 20.00, 1 FROM menu_products p WHERE p.name = 'Tempura'
ON DUPLICATE KEY UPDATE price = 20.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '16 pcs', 20.00, 1 FROM menu_products p WHERE p.name = 'Fishball'
ON DUPLICATE KEY UPDATE price = 20.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '4 pcs', 20.00, 1 FROM menu_products p WHERE p.name = 'Siomai'
ON DUPLICATE KEY UPDATE price = 20.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '4 pcs', 20.00, 1 FROM menu_products p WHERE p.name = 'Lumpia'
ON DUPLICATE KEY UPDATE price = 20.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, 'Regular', 35.00, 1 FROM menu_products p WHERE p.name = 'Fries & Sip'
ON DUPLICATE KEY UPDATE price = 35.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '2 Burgers', 55.00, 1 FROM menu_products p WHERE p.name = 'Burger (Buy 1 Take 1)'
ON DUPLICATE KEY UPDATE price = 55.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, 'Regular', 45.00, 1 FROM menu_products p WHERE p.name = 'Hotdog Bun'
ON DUPLICATE KEY UPDATE price = 45.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '500ml Tub', 95.00, 1 FROM menu_products p WHERE p.name = 'Mango Graham Float'
ON DUPLICATE KEY UPDATE price = 95.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 39.00, 1 FROM menu_products p WHERE p.name = 'Taro Milktea'
ON DUPLICATE KEY UPDATE price = 39.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 39.00, 1 FROM menu_products p WHERE p.name = 'Cookies and Cream Milktea'
ON DUPLICATE KEY UPDATE price = 39.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 39.00, 1 FROM menu_products p WHERE p.name = 'Chocolate Milktea'
ON DUPLICATE KEY UPDATE price = 39.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 39.00, 1 FROM menu_products p WHERE p.name = 'Classic Milktea'
ON DUPLICATE KEY UPDATE price = 39.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 39.00, 1 FROM menu_products p WHERE p.name = 'Matcha Iced Coffee'
ON DUPLICATE KEY UPDATE price = 39.00, display_order = 1;

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, '12oz', 39.00, 1 FROM menu_products p WHERE p.name = 'Caramel Iced Coffee'
ON DUPLICATE KEY UPDATE price = 39.00, display_order = 1;
