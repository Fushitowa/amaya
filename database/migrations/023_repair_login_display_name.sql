USE amaya;

-- The login route reads display_name; add the optional field if an older schema lacks it.
SET @has_display_name = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'users'
     AND column_name = 'display_name'
);
SET @add_display_name_sql = IF(
  @has_display_name = 0,
  'ALTER TABLE users ADD COLUMN display_name VARCHAR(100) NULL AFTER username',
  'SELECT 1'
);
PREPARE add_display_name_stmt FROM @add_display_name_sql;
EXECUTE add_display_name_stmt;
DEALLOCATE PREPARE add_display_name_stmt;
