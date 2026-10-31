USE amaya;

-- Repair databases where migration 019 was recorded but its column is missing.
SET @has_operational_family = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'menu_categories'
     AND column_name = 'operational_family'
);
SET @add_operational_family_sql = IF(
  @has_operational_family = 0,
  "ALTER TABLE menu_categories ADD COLUMN operational_family ENUM('drink', 'fries', 'snack_pieces', 'single_fixed', 'general') NOT NULL DEFAULT 'general'",
  'SELECT 1'
);
PREPARE add_operational_family_stmt FROM @add_operational_family_sql;
EXECUTE add_operational_family_stmt;
DEALLOCATE PREPARE add_operational_family_stmt;

UPDATE menu_categories
   SET operational_family = 'drink'
 WHERE name IN ('Milktea', 'Float Series', 'Fruity Soda', 'Fruity Milk', 'Iced Coffee')
   AND operational_family = 'general';
UPDATE menu_categories
   SET operational_family = 'fries'
 WHERE name = 'Fries & Sip' AND operational_family = 'general';
UPDATE menu_categories
   SET operational_family = 'snack_pieces'
 WHERE name = 'Foods / Snacks' AND operational_family = 'general';
UPDATE menu_categories
   SET operational_family = 'single_fixed'
 WHERE name IN ('Burgers and Hotdogs', 'Desserts') AND operational_family = 'general';
