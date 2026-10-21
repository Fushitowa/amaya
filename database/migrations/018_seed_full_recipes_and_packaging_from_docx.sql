USE amaya;

-- ============================================================================
-- 1. UPSERT THE 14 PACKAGING & CONDIMENT ITEMS INTO inventory_items
-- ============================================================================
INSERT INTO inventory_items (name, category, unit, quantity, maximum_stock, purchase_price, package_quantity, package_unit, contents_per_package, unit_cost, is_archived, archived_at)
VALUES
  ('Small Greaseproof Fry Pouch', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 45.00, 1.000, 'pack', 100.000, 0.450000, FALSE, NULL),
  ('Medium Greaseproof Fry Pouch', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 65.00, 1.000, 'pack', 100.000, 0.650000, FALSE, NULL),
  ('Large Fry Pouch / Box', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 120.00, 1.000, 'pack', 100.000, 1.200000, FALSE, NULL),
  ('Kraft Food Boat Tray', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 110.00, 1.000, 'pack', 100.000, 1.100000, FALSE, NULL),
  ('Burger Wax Wrapper', 'Packaging & Disposables', 'pcs', 500.000, 1000.000, 28.00, 1.000, 'pack', 100.000, 0.280000, FALSE, NULL),
  ('Bamboo Skewers & Toothpicks', 'Packaging & Disposables', 'pcs', 1000.000, 2000.000, 45.00, 1.000, 'pack', 500.000, 0.090000, FALSE, NULL),
  ('Fries & Sip 2-in-1 Combo Cup', 'Packaging & Disposables', 'pcs', 200.000, 500.000, 140.00, 1.000, 'pack', 50.000, 2.800000, FALSE, NULL),
  ('Aonori (Dried Seaweed)', 'Powders & Seasonings', 'g', 500.000, 1000.000, 150.00, 1.000, 'pack', 100.000, 1.500000, FALSE, NULL),
  ('Takoyaki Fillings (Squid/Crab)', 'Snack Ingredients & Meats', 'g', 3000.000, 6000.000, 240.00, 1.000, 'pack', 1000.000, 0.240000, FALSE, NULL),
  ('Shredded Cabbage', 'Snack Ingredients & Meats', 'g', 5000.000, 10000.000, 65.00, 1.000, 'kg', 1000.000, 0.065000, FALSE, NULL),
  ('Toyomansi Blend', 'Cooking & Condiments', 'ml', 3000.000, 6000.000, 55.00, 1.000, 'bottle', 1000.000, 0.055000, FALSE, NULL),
  ('Mayo-Ketchup Dressing', 'Cooking & Condiments', 'ml', 4000.000, 8000.000, 320.00, 1.000, 'gallon', 3785.000, 0.084544, FALSE, NULL),
  ('Cheddar Cheese Sauce', 'Cooking & Condiments', 'g', 2000.000, 4000.000, 150.00, 1.000, 'pouch', 1000.000, 0.150000, FALSE, NULL),
  ('Chocolate Drizzle Syrup', 'Syrups & Purees', 'g', 2000.000, 4000.000, 165.00, 1.000, 'bottle', 680.000, 0.242647, FALSE, NULL)
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
-- 2. HARMONIZE PRODUCT NAMES WITH OFFICIAL STORE CATALOG
-- ============================================================================
UPDATE menu_products SET name = 'Fries' WHERE name = 'French Fries';
UPDATE menu_products SET name = 'Lumpia Shanghai' WHERE name = 'Lumpia';
UPDATE menu_products SET name = 'Fishballs' WHERE name = 'Fishball';

-- ============================================================================
-- 3. SEED BASE RECIPES IN product_ingredients (FOR ALL PRODUCTS)
-- ============================================================================

-- Tempura: 4 pcs Tempura, 20ml sweet chili, 12ml oil, 1 skewer
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 4.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Tempura' AND i.name = 'Street Food Tempura'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 20.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Tempura' AND i.name = 'Sweet Chili Sauce'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 12.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Tempura' AND i.name = 'Cooking Oil (Palm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Tempura' AND i.name = 'Bamboo Skewers & Toothpicks'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Fishballs: 16 pcs Fishballs, 25ml sweet chili, 12ml oil, 1 skewer
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 16.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Fishballs' AND i.name = 'Street Food Fishballs'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 25.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Fishballs' AND i.name = 'Sweet Chili Sauce'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 12.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Fishballs' AND i.name = 'Cooking Oil (Palm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Fishballs' AND i.name = 'Bamboo Skewers & Toothpicks'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Siomai: 4 pcs Siomai, 5g chili garlic, 12ml toyomansi, 1 food boat
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 4.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Siomai' AND i.name = 'Pork Siomai'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 5.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Siomai' AND i.name = 'Chili Garlic Paste'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 12.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Siomai' AND i.name = 'Toyomansi Blend'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Siomai' AND i.name = 'Kraft Food Boat Tray'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Lumpia Shanghai: 4 pcs Lumpia, 15ml sweet chili, 12ml oil, 1 food boat
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 4.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Lumpia Shanghai' AND i.name = 'Pork Lumpiang Shanghai'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 15.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Lumpia Shanghai' AND i.name = 'Sweet Chili Sauce'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 12.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Lumpia Shanghai' AND i.name = 'Cooking Oil (Palm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Lumpia Shanghai' AND i.name = 'Kraft Food Boat Tray'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Fries & Sip: 65g fries, 4g seasoning, 8ml oil, 180ml Coke, 50g ice, 1 combo cup, 1 straw
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 65.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Fries & Sip' AND i.name = 'French Fries (Shoestring)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 4.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Fries & Sip' AND i.name = 'Cheese Seasoning Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 8.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Fries & Sip' AND i.name = 'Cooking Oil (Palm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 180.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Fries & Sip' AND i.name = 'Coca-Cola'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 50.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Fries & Sip' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Fries & Sip' AND i.name = 'Fries & Sip 2-in-1 Combo Cup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Fries & Sip' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Burger (Buy 1 Take 1): 2 patties, 2 buns, 25ml mayo-ketchup, 2 wrappers
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 2.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Burger (Buy 1 Take 1)' AND i.name = 'Burger Patties (Beef)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 2.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Burger (Buy 1 Take 1)' AND i.name = 'Burger Buns'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 25.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Burger (Buy 1 Take 1)' AND i.name = 'Mayo-Ketchup Dressing'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 2.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Burger (Buy 1 Take 1)' AND i.name = 'Burger Wax Wrapper'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Hotdog Bun: 1 jumbo hotdog, 1 hotdog bun, 20ml mayo-ketchup, 16g cheese sauce, 1 food boat
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Hotdog Bun' AND i.name = 'Jumbo Hotdogs'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Hotdog Bun' AND i.name = 'Hotdog Buns'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 20.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Hotdog Bun' AND i.name = 'Mayo-Ketchup Dressing'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 16.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Hotdog Bun' AND i.name = 'Cheddar Cheese Sauce'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Hotdog Bun' AND i.name = 'Kraft Food Boat Tray'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Mango Graham Float: 125ml AP cream, 95g condensed milk, 50g grahams, 120g fresh mango, 1 dessert tub
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 125.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Mango Graham Float' AND i.name = 'All-Purpose Cream'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 95.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Mango Graham Float' AND i.name = 'Condensed Milk'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 50.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Mango Graham Float' AND i.name = 'Graham Crackers'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 120.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Mango Graham Float' AND i.name = 'Ripe Carabao Mangoes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Mango Graham Float' AND i.name = '500ml Dessert Tub with Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Taro Milktea: 35g taro powder, 35g pearls, 100g ice, 1 12oz cup, 1 flat lid, 1 boba straw
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 35.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Taro Milktea' AND i.name = 'Taro Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 35.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Taro Milktea' AND i.name = 'Black Pearl (Sago)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 100.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Taro Milktea' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Taro Milktea' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Taro Milktea' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Taro Milktea' AND i.name = 'Boba Straw (12mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Cookies and Cream Milktea: 35g C&C powder, 35g pearls, 100g ice, 1 12oz cup, 1 flat lid, 1 boba straw
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 35.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Cookies and Cream Milktea' AND i.name = 'Cookies and Cream Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 35.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Cookies and Cream Milktea' AND i.name = 'Black Pearl (Sago)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 100.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Cookies and Cream Milktea' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Cookies and Cream Milktea' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Cookies and Cream Milktea' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Cookies and Cream Milktea' AND i.name = 'Boba Straw (12mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Chocolate Milktea: 35g choco powder, 35g pearls, 100g ice, 1 12oz cup, 1 flat lid, 1 boba straw
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 35.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Chocolate Milktea' AND i.name = 'Chocolate Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 35.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Chocolate Milktea' AND i.name = 'Black Pearl (Sago)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 100.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Chocolate Milktea' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Chocolate Milktea' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Chocolate Milktea' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Chocolate Milktea' AND i.name = 'Boba Straw (12mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Classic Milktea: 30g milk powder, 35g pearls, 100g ice, 1 12oz cup, 1 flat lid, 1 boba straw
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 30.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Classic Milktea' AND i.name = 'Milk Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 35.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Classic Milktea' AND i.name = 'Black Pearl (Sago)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 100.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Classic Milktea' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Classic Milktea' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Classic Milktea' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Classic Milktea' AND i.name = 'Boba Straw (12mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Matcha Iced Coffee: 18g espresso beans, 12g matcha powder, 120ml fresh milk, 80g ice, 1 12oz cup, 1 flat lid, 1 straw
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 18.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Matcha Iced Coffee' AND i.name = 'Espresso Coffee Beans'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 12.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Matcha Iced Coffee' AND i.name = 'Matcha Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 120.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Matcha Iced Coffee' AND i.name = 'Fresh Milk (UHT)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 80.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Matcha Iced Coffee' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Matcha Iced Coffee' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Matcha Iced Coffee' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Matcha Iced Coffee' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Caramel Iced Coffee: 18g espresso beans, 25ml caramel syrup, 120ml fresh milk, 80g ice, 1 12oz cup, 1 flat lid, 1 straw
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 18.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Caramel Iced Coffee' AND i.name = 'Espresso Coffee Beans'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 25.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Caramel Iced Coffee' AND i.name = 'Caramel Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 120.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Caramel Iced Coffee' AND i.name = 'Fresh Milk (UHT)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 80.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Caramel Iced Coffee' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Caramel Iced Coffee' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Caramel Iced Coffee' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 1.000, 'pcs' FROM menu_products p, inventory_items i WHERE p.name = 'Caramel Iced Coffee' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Base recipes for multi-size products (Regular size fallback)
INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 80.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Fries' AND i.name = 'French Fries (Shoestring)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 36.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Takoyaki' AND i.name = 'Takoyaki Premix Flour'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 160.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Coke Float' AND i.name = 'Coca-Cola'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 20.000, 'g' FROM menu_products p, inventory_items i WHERE p.name = 'Choco Float' AND i.name = 'Chocolate Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 22.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Blueberry Soda' AND i.name = 'Blueberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 22.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Green Apple Soda' AND i.name = 'Green Apple Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 22.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Strawberry Soda' AND i.name = 'Strawberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 22.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Strawberry Milk' AND i.name = 'Strawberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
SELECT p.id, i.id, 22.000, 'ml' FROM menu_products p, inventory_items i WHERE p.name = 'Mango Milk' AND i.name = 'Mango Fruit Puree'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- ============================================================================
-- 4. SEED MULTI-SIZE SPECIFIC RECIPES IN product_size_ingredients
-- ============================================================================

-- Fries (Regular: 80g fries, 5g cheese powder, 10ml oil, 1 Small bag)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 80.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Regular' AND i.name = 'French Fries (Shoestring)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 5.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Regular' AND i.name = 'Cheese Seasoning Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 10.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Regular' AND i.name = 'Cooking Oil (Palm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Regular' AND i.name = 'Small Greaseproof Fry Pouch'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Fries (Medium: 160g fries, 10g powder, 18ml oil, 1 Med bag)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 160.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Medium' AND i.name = 'French Fries (Shoestring)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 10.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Medium' AND i.name = 'Cheese Seasoning Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 18.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Medium' AND i.name = 'Cooking Oil (Palm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Medium' AND i.name = 'Medium Greaseproof Fry Pouch'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Fries (Large: 330g fries, 20g powder, 35ml oil, 1 Large box)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 330.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Large' AND i.name = 'French Fries (Shoestring)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 20.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Large' AND i.name = 'Cheese Seasoning Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 35.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Large' AND i.name = 'Cooking Oil (Palm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Fries' AND ps.label = 'Large' AND i.name = 'Large Fry Pouch / Box'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Takoyaki (4 pcs: 36g premix, 24g cabbage, 16g filling, 15ml tako sauce, 15g mayo, 2g bonito, 1g aonori, 1 Boat tray)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 36.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '4 pcs' AND i.name = 'Takoyaki Premix Flour'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 24.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '4 pcs' AND i.name = 'Shredded Cabbage'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 16.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '4 pcs' AND i.name = 'Takoyaki Fillings (Squid/Crab)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 15.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '4 pcs' AND i.name = 'Takoyaki Sauce'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 15.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '4 pcs' AND i.name = 'Japanese Mayonnaise'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 2.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '4 pcs' AND i.name = 'Bonito Flakes (Katsuobushi)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '4 pcs' AND i.name = 'Aonori (Dried Seaweed)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '4 pcs' AND i.name = 'Kraft Food Boat Tray'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Takoyaki (6 pcs: 54g premix, 36g cabbage, 24g filling, 22ml sauce, 22g mayo, 3g bonito, 1.5g aonori, 1 Boat tray)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 54.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '6 pcs' AND i.name = 'Takoyaki Premix Flour'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 36.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '6 pcs' AND i.name = 'Shredded Cabbage'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 24.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '6 pcs' AND i.name = 'Takoyaki Fillings (Squid/Crab)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 22.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '6 pcs' AND i.name = 'Takoyaki Sauce'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 22.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '6 pcs' AND i.name = 'Japanese Mayonnaise'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 3.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '6 pcs' AND i.name = 'Bonito Flakes (Katsuobushi)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.500, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '6 pcs' AND i.name = 'Aonori (Dried Seaweed)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '6 pcs' AND i.name = 'Kraft Food Boat Tray'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Takoyaki (12 pcs: 108g premix, 72g cabbage, 48g filling, 45ml sauce, 45g mayo, 6g bonito, 3g aonori, 1 Large box)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 108.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '12 pcs' AND i.name = 'Takoyaki Premix Flour'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 72.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '12 pcs' AND i.name = 'Shredded Cabbage'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 48.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '12 pcs' AND i.name = 'Takoyaki Fillings (Squid/Crab)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 45.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '12 pcs' AND i.name = 'Takoyaki Sauce'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 45.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '12 pcs' AND i.name = 'Japanese Mayonnaise'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 6.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '12 pcs' AND i.name = 'Bonito Flakes (Katsuobushi)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 3.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '12 pcs' AND i.name = 'Aonori (Dried Seaweed)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Takoyaki' AND ps.label = '12 pcs' AND i.name = 'Large Fry Pouch / Box'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Coke Float (8oz & 12oz)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 160.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '8oz' AND i.name = 'Coca-Cola'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 25.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '8oz' AND i.name = 'Vanilla Ice Cream'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 5.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '8oz' AND i.name = 'Chocolate Drizzle Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 30.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '8oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '8oz' AND i.name = '8oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '8oz' AND i.name = '95mm Dome Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '8oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 240.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '12oz' AND i.name = 'Coca-Cola'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 40.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '12oz' AND i.name = 'Vanilla Ice Cream'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 8.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '12oz' AND i.name = 'Chocolate Drizzle Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 50.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '12oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '12oz' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '12oz' AND i.name = '95mm Dome Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Coke Float' AND ps.label = '12oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Choco Float (8oz & 12oz)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 20.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '8oz' AND i.name = 'Chocolate Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 25.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '8oz' AND i.name = 'Vanilla Ice Cream'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 5.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '8oz' AND i.name = 'Chocolate Drizzle Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 30.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '8oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '8oz' AND i.name = '8oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '8oz' AND i.name = '95mm Dome Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '8oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 30.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '12oz' AND i.name = 'Chocolate Powder'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 40.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '12oz' AND i.name = 'Vanilla Ice Cream'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 8.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '12oz' AND i.name = 'Chocolate Drizzle Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 50.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '12oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '12oz' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '12oz' AND i.name = '95mm Dome Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Choco Float' AND ps.label = '12oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Fruity Soda (Blueberry, Green Apple, Strawberry 8oz & 12oz)
-- Blueberry Soda
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 22.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '8oz' AND i.name = 'Blueberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 110.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '8oz' AND i.name = 'Sparkling Soda Water'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 50.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '8oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '8oz' AND i.name = '8oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '8oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '8oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 35.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '12oz' AND i.name = 'Blueberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 160.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '12oz' AND i.name = 'Sparkling Soda Water'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 80.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '12oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '12oz' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '12oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Blueberry Soda' AND ps.label = '12oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Green Apple Soda
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 22.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '8oz' AND i.name = 'Green Apple Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 110.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '8oz' AND i.name = 'Sparkling Soda Water'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 50.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '8oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '8oz' AND i.name = '8oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '8oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '8oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 35.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '12oz' AND i.name = 'Green Apple Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 160.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '12oz' AND i.name = 'Sparkling Soda Water'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 80.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '12oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '12oz' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '12oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Green Apple Soda' AND ps.label = '12oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Strawberry Soda
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 22.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '8oz' AND i.name = 'Strawberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 110.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '8oz' AND i.name = 'Sparkling Soda Water'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 50.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '8oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '8oz' AND i.name = '8oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '8oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '8oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 35.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '12oz' AND i.name = 'Strawberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 160.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '12oz' AND i.name = 'Sparkling Soda Water'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 80.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '12oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '12oz' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '12oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Soda' AND ps.label = '12oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Strawberry Milk (8oz & 12oz)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 22.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '8oz' AND i.name = 'Strawberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 100.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '8oz' AND i.name = 'Fresh Milk (UHT)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 40.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '8oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '8oz' AND i.name = '8oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '8oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '8oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 35.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '12oz' AND i.name = 'Strawberry Fruit Syrup'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 150.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '12oz' AND i.name = 'Fresh Milk (UHT)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 60.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '12oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '12oz' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '12oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Strawberry Milk' AND ps.label = '12oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

-- Mango Milk (8oz & 12oz)
INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 22.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '8oz' AND i.name = 'Mango Fruit Puree'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 100.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '8oz' AND i.name = 'Fresh Milk (UHT)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 40.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '8oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '8oz' AND i.name = '8oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '8oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '8oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 35.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '12oz' AND i.name = 'Mango Fruit Puree'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 150.000, 'ml' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '12oz' AND i.name = 'Fresh Milk (UHT)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 60.000, 'g' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '12oz' AND i.name = 'Ice Cubes'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '12oz' AND i.name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '12oz' AND i.name = '95mm Flat Lid'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);

INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
SELECT ps.id, i.id, 1.000, 'pcs' FROM product_sizes ps JOIN menu_products p ON ps.product_id = p.id, inventory_items i
WHERE p.name = 'Mango Milk' AND ps.label = '12oz' AND i.name = 'Regular Wrapped Straw'
ON DUPLICATE KEY UPDATE quantity_used = VALUES(quantity_used), unit = VALUES(unit);
