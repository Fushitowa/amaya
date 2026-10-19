-- Maximum stock is an upper limit, not a reorder threshold. Existing minimum
-- values cannot be safely translated, so existing items start with no maximum.
ALTER TABLE inventory_items
  ADD COLUMN maximum_stock DECIMAL(12,3) NULL DEFAULT NULL AFTER unit;

ALTER TABLE inventory_items
  DROP COLUMN minimum_stock;

ALTER TABLE inventory_alert_states
  MODIFY COLUMN status ENUM('healthy', 'low', 'out', 'over') NOT NULL;
