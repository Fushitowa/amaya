USE amaya;

-- Migration 010: Add purchase pricing, package quantities, and unit cost to inventory_items
ALTER TABLE inventory_items
    ADD COLUMN IF NOT EXISTS purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS package_quantity DECIMAL(12,3) NOT NULL DEFAULT 1.000,
    ADD COLUMN IF NOT EXISTS package_unit VARCHAR(40) NOT NULL DEFAULT 'pack',
    ADD COLUMN IF NOT EXISTS contents_per_package DECIMAL(12,3) NOT NULL DEFAULT 1.000,
    ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0.0000;
