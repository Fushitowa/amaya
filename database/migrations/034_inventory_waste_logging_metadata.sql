-- Migration 034: Add zero-guesswork waste & spoilage measurement metadata and reversal linkage to inventory_movements.

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'waste_reason') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN waste_reason VARCHAR(64) NULL AFTER note',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'measurement_method') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN measurement_method VARCHAR(32) NULL AFTER waste_reason',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'measured_input_qty') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN measured_input_qty DECIMAL(12,6) NULL AFTER measurement_method',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'measured_input_unit') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN measured_input_unit VARCHAR(32) NULL AFTER measured_input_qty',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'tare_weight') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN tare_weight DECIMAL(12,6) NULL AFTER measured_input_unit',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'client_request_id') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN client_request_id VARCHAR(100) NULL AFTER tare_weight',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND column_name = 'reversed_by_movement_id') = 0,
  'ALTER TABLE inventory_movements ADD COLUMN reversed_by_movement_id BIGINT UNSIGNED NULL AFTER client_request_id',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'uq_inventory_movements_client_request') = 0,
  'ALTER TABLE inventory_movements ADD UNIQUE KEY uq_inventory_movements_client_request (client_request_id)',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_type_created') = 0,
  'ALTER TABLE inventory_movements ADD KEY idx_inventory_movements_type_created (movement_type, created_at)',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

SET @sql_034 = IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_movements' AND index_name = 'idx_inventory_movements_waste_reason') = 0,
  'ALTER TABLE inventory_movements ADD KEY idx_inventory_movements_waste_reason (waste_reason)',
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;

-- Guard notifications.type in case any environment defined it as ENUM rather than VARCHAR
SET @notif_type_enum_034 = (
  SELECT COLUMN_TYPE
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'notifications'
    AND column_name = 'type'
    AND LOWER(DATA_TYPE) = 'enum'
  LIMIT 1
);

SET @sql_034 = IF(
  @notif_type_enum_034 IS NOT NULL AND @notif_type_enum_034 NOT LIKE '%''inventory_waste''%',
  CONCAT(
    'ALTER TABLE notifications MODIFY COLUMN type ',
    SUBSTRING(@notif_type_enum_034, 1, CHAR_LENGTH(@notif_type_enum_034) - 1),
    ',''inventory_waste'') NOT NULL'
  ),
  'SELECT 1'
);
PREPARE stmt_034 FROM @sql_034; EXECUTE stmt_034; DEALLOCATE PREPARE stmt_034;
