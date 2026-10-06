-- Expand product image storage and ensure the menu category list exists.
USE amaya;

ALTER TABLE menu_products MODIFY image_url LONGTEXT NULL;

INSERT INTO menu_categories (name, description, display_order, is_active) VALUES
  ('Milk Tea', 'Creamy and sweet milktea selections.', 1, TRUE),
  ('Drinks', 'Refreshing drinks and crafted cafe favorites.', 2, TRUE),
  ('Snacks', 'Savory bites and comfort snack classics.', 3, TRUE),
  ('Desserts', 'Sweet desserts and finishing treats.', 4, TRUE)
ON DUPLICATE KEY UPDATE description = VALUES(description), display_order = VALUES(display_order), is_active = TRUE;
