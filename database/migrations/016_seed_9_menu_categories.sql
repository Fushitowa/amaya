USE amaya;

-- 1. Seed/Update the 9 Canonical Menu Categories with ON DUPLICATE KEY UPDATE
INSERT INTO menu_categories (name, description, display_order, is_active) VALUES
  ('Foods / Snacks', 'Crispy bites, street food, and comfort snacks.', 1, TRUE),
  ('Fries & Sip', 'Crispy seasoned fries paired with your favorite sip.', 2, TRUE),
  ('Burgers and Hotdogs', 'Juicy grilled patties, savory sausages, and loaded buns.', 3, TRUE),
  ('Desserts', 'Sweet signature treats and decadent indulgences.', 4, TRUE),
  ('Milktea', 'Creamy, rich milk teas with custom sweetness and toppings.', 5, TRUE),
  ('Float Series', 'Chilled flavored drinks crowned with soft, velvety ice cream.', 6, TRUE),
  ('Fruity Soda', 'Sparkling, effervescent fruit-infused coolers.', 7, TRUE),
  ('Fruity Milk', 'Silky fresh milk blends swirled with luscious fruit purees.', 8, TRUE),
  ('Iced Coffee', 'Bold espresso pours brewed cold over fresh milk and ice.', 9, TRUE)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  display_order = VALUES(display_order),
  is_active = TRUE;

-- 2. Seed 8oz and 12oz PP Cups into inventory_items
INSERT INTO inventory_items (name, category, unit, quantity, maximum_stock, purchase_price, package_quantity, package_unit, contents_per_package, unit_cost)
VALUES
  ('8oz PP Cup (95mm)', 'Cups & Lids', 'pcs', 100.000, 500.000, 150.00, 1.000, 'pack', 100.000, 1.5000),
  ('12oz PP Cup (95mm)', 'Cups & Lids', 'pcs', 100.000, 500.000, 180.00, 1.000, 'pack', 100.000, 1.8000)
ON DUPLICATE KEY UPDATE
  category = VALUES(category),
  unit = VALUES(unit);

-- 3. Seed corresponding inventory_cups rows
INSERT INTO inventory_cups (inventory_item_id, cup_size_oz, material, lid_diameter_mm, capacity_ml)
SELECT id, 8.0, 'PP', 95, 240.00 FROM inventory_items WHERE name = '8oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE cup_size_oz = 8.0, material = 'PP', lid_diameter_mm = 95, capacity_ml = 240.00;

INSERT INTO inventory_cups (inventory_item_id, cup_size_oz, material, lid_diameter_mm, capacity_ml)
SELECT id, 12.0, 'PP', 95, 360.00 FROM inventory_items WHERE name = '12oz PP Cup (95mm)'
ON DUPLICATE KEY UPDATE cup_size_oz = 12.0, material = 'PP', lid_diameter_mm = 95, capacity_ml = 360.00;
