-- Enforce [0.1000, 0.9000] bounds on business_settings.target_food_cost idempotently

UPDATE business_settings
   SET target_food_cost = LEAST(0.9000, GREATEST(0.1000, target_food_cost))
 WHERE target_food_cost < 0.1000 OR target_food_cost > 0.9000;

SET @sql_029 = IF(
  (SELECT COUNT(*)
     FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'business_settings'
      AND constraint_name = 'chk_business_settings_target_food_cost') = 0,
  'ALTER TABLE business_settings ADD CONSTRAINT chk_business_settings_target_food_cost CHECK (target_food_cost >= 0.1000 AND target_food_cost <= 0.9000)',
  'SELECT 1'
);
PREPARE stmt_029 FROM @sql_029;
EXECUTE stmt_029;
DEALLOCATE PREPARE stmt_029;
