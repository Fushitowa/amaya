-- Expand image storage for the app's existing uploads and seed the bundled
-- starter catalog. Safe to rerun: existing category and product rows are kept.
USE amaya;

ALTER TABLE menu_products MODIFY image_url LONGTEXT NULL;

INSERT INTO menu_categories (name, description, display_order, is_active) VALUES
  ('Milk Tea', 'Creamy and sweet milktea selections.', 1, TRUE),
  ('Drinks', 'Refreshing drinks and crafted cafe favorites.', 2, TRUE),
  ('Snacks', 'Savory bites and comfort snack classics.', 3, TRUE),
  ('Desserts', 'Sweet desserts and finishing treats.', 4, TRUE)
ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id);

INSERT INTO menu_products (category_id, name, description, image_url, base_price, stock_quantity, is_available, is_featured)
SELECT c.id, seed.name, CONCAT('Amaya ', LOWER(c.name), ' favorite.'), NULL, seed.price, 20, TRUE, seed.featured
FROM (
  SELECT 'Classic' AS name, 'Milk Tea' AS category, 39.00 AS price, TRUE AS featured UNION ALL
  SELECT 'Chocolate', 'Milk Tea', 39.00, TRUE UNION ALL
  SELECT 'Cookie & Cream', 'Milk Tea', 39.00, TRUE UNION ALL
  SELECT 'Matcha', 'Milk Tea', 39.00, FALSE UNION ALL
  SELECT 'Mango', 'Drinks', 30.00, FALSE UNION ALL
  SELECT 'Caramel', 'Drinks', 39.00, FALSE UNION ALL
  SELECT 'Coke Float', 'Drinks', 25.00, FALSE UNION ALL
  SELECT 'Choco Float', 'Drinks', 25.00, FALSE UNION ALL
  SELECT 'Blueberry', 'Drinks', 25.00, FALSE UNION ALL
  SELECT 'Green Apple', 'Drinks', 25.00, FALSE UNION ALL
  SELECT 'Strawberry Milk', 'Drinks', 30.00, FALSE UNION ALL
  SELECT 'Strawberry', 'Drinks', 25.00, FALSE UNION ALL
  SELECT 'Lumpia', 'Snacks', 20.00, FALSE UNION ALL
  SELECT 'Takoyaki', 'Snacks', 30.00, FALSE UNION ALL
  SELECT 'Burger', 'Snacks', 55.00, FALSE UNION ALL
  SELECT 'Hotdog Bun', 'Snacks', 45.00, FALSE UNION ALL
  SELECT 'Tempura', 'Snacks', 20.00, FALSE UNION ALL
  SELECT 'Fishball', 'Snacks', 20.00, FALSE UNION ALL
  SELECT 'Siomai', 'Snacks', 20.00, FALSE UNION ALL
  SELECT 'Mango Float', 'Desserts', 95.00, FALSE
) AS seed
JOIN menu_categories c ON c.name = seed.category
WHERE NOT EXISTS (SELECT 1 FROM menu_products existing WHERE existing.name = seed.name);

INSERT INTO product_sizes (product_id, label, price, display_order)
SELECT p.id, 'Regular', p.base_price, 0
FROM menu_products p
WHERE NOT EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = p.id AND s.label = 'Regular');
