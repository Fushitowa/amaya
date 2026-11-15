-- Migration 035: Align waste measurement precision/width with inventory_items (DECIMAL(16,6), VARCHAR(40))
-- and scope client_request_id idempotency uniquely per actor (user_id, client_request_id).

SET @sql_035 = (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'inventory_movements'
        AND column_name = 'measured_input_qty'
    ),
    'ALTER TABLE inventory_movements MODIFY COLUMN measured_input_qty DECIMAL(16,6) NULL, MODIFY COLUMN tare_weight DECIMAL(16,6) NULL, MODIFY COLUMN measured_input_unit VARCHAR(40) NULL',
    'SELECT 1'
  )
);
PREPARE stmt_035 FROM @sql_035; EXECUTE stmt_035; DEALLOCATE PREPARE stmt_035;

SET @sql_035 = IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND index_name = 'uq_inventory_movements_client_request'
  ) > 0,
  'ALTER TABLE inventory_movements DROP INDEX uq_inventory_movements_client_request',
  'SELECT 1'
);
PREPARE stmt_035 FROM @sql_035; EXECUTE stmt_035; DEALLOCATE PREPARE stmt_035;

SET @sql_035 = IF(
  (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory_movements'
      AND index_name = 'uq_inventory_movements_user_client_request'
  ) = 0,
  'ALTER TABLE inventory_movements ADD UNIQUE KEY uq_inventory_movements_user_client_request (user_id, client_request_id)',
  'SELECT 1'
);
PREPARE stmt_035 FROM @sql_035; EXECUTE stmt_035; DEALLOCATE PREPARE stmt_035;

SET @notif_type_enum_035 = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'notifications'
    AND column_name = 'type'
    AND LOWER(DATA_TYPE) = 'enum'
  LIMIT 1
);

SET @notif_type_default_035 = (
  SELECT COLUMN_DEFAULT
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'notifications'
    AND column_name = 'type'
    AND LOWER(DATA_TYPE) = 'enum'
  LIMIT 1
);

SET @sql_035 = IF(
  @notif_type_enum_035 IS NOT NULL AND @notif_type_enum_035 NOT LIKE '%''inventory_waste''%',
  CONCAT(
    'ALTER TABLE notifications MODIFY COLUMN type ',
    SUBSTRING(@notif_type_enum_035, 1, CHAR_LENGTH(@notif_type_enum_035) - 1),
    ',''inventory_waste'') NOT NULL',
    IF(@notif_type_default_035 IS NOT NULL, CONCAT(' DEFAULT ', QUOTE(@notif_type_default_035)), '')
  ),
  'SELECT 1'
);
PREPARE stmt_035 FROM @sql_035; EXECUTE stmt_035; DEALLOCATE PREPARE stmt_035;
