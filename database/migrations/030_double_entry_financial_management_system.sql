-- Migration 030: Double-Entry Financial Management & Asset Reconciliation System

-- 1. Chart of Accounts Table
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_code VARCHAR(20) NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_category ENUM('asset', 'liability', 'equity', 'revenue', 'expense') NOT NULL,
    normal_balance ENUM('debit', 'credit') NOT NULL,
    is_system_locked BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_coa_code (account_code),
    KEY idx_coa_category (account_category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Seed Standard Accounts
INSERT INTO chart_of_accounts (account_code, account_name, account_category, normal_balance, is_system_locked)
VALUES 
  ('1010', 'Cash Drawer (Counter 1)', 'asset', 'debit', TRUE),
  ('1020', 'GCash Official Wallet', 'asset', 'debit', TRUE),
  ('1030', 'Store Bank Account', 'asset', 'debit', TRUE),
  ('1040', 'Owner Capital Reserve', 'asset', 'debit', TRUE),
  ('1050', 'Merchandise Inventory', 'asset', 'debit', TRUE),
  ('1510', 'Store Equipment & Fixtures', 'asset', 'debit', FALSE),
  ('2010', 'Accounts Payable', 'liability', 'credit', FALSE),
  ('2020', 'Tax Payable', 'liability', 'credit', FALSE),
  ('3010', 'Owner\'s Capital / Equity', 'equity', 'credit', TRUE),
  ('3020', 'Owner\'s Drawings', 'equity', 'debit', TRUE),
  ('4010', 'Food & Beverage Sales', 'revenue', 'credit', TRUE),
  ('4020', 'Sales Discounts', 'revenue', 'debit', TRUE),
  ('5010', 'Cost of Goods Sold (COGS)', 'expense', 'debit', TRUE),
  ('6010', 'Operating Expenses (OPEX)', 'expense', 'debit', TRUE),
  ('6020', 'Utilities & Rent Expense', 'expense', 'debit', FALSE),
  ('6030', 'Inventory Wastage & Spoilage', 'expense', 'debit', TRUE),
  ('6040', 'Cash Drawer Discrepancy', 'expense', 'debit', TRUE)
ON DUPLICATE KEY UPDATE account_name = VALUES(account_name);

-- 3. Journal Entries Header (Immutable, Append-Only)
CREATE TABLE IF NOT EXISTS journal_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entry_number VARCHAR(32) NOT NULL,
    entry_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    entry_type ENUM(
        'opening_balance',
        'sales_revenue',
        'cogs_consumption',
        'inventory_restock',
        'operating_expense',
        'capital_injection',
        'owner_withdrawal',
        'account_transfer',
        'void_reversal',
        'adjustment'
    ) NOT NULL,
    memo VARCHAR(255) NOT NULL,
    reference_number VARCHAR(100) NULL,
    order_id BIGINT UNSIGNED NULL,
    inventory_movement_id BIGINT UNSIGNED NULL,
    session_id BIGINT UNSIGNED NULL,
    is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
    reverses_entry_id BIGINT UNSIGNED NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_je_entry_number (entry_number),
    KEY idx_je_date (entry_date),
    KEY idx_je_type (entry_type),
    KEY idx_je_order (order_id),
    KEY idx_je_session (session_id),
    CONSTRAINT fk_je_order FOREIGN KEY (order_id) REFERENCES orders (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_je_session FOREIGN KEY (session_id) REFERENCES cashier_sessions (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_je_reverses FOREIGN KEY (reverses_entry_id) REFERENCES journal_entries (id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_je_user FOREIGN KEY (created_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Journal Entry Lines (Debits and Credits)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    journal_entry_id BIGINT UNSIGNED NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    debit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    credit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    line_memo VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_jel_entry (journal_entry_id),
    KEY idx_jel_account (account_id),
    CONSTRAINT chk_jel_non_negative CHECK (debit >= 0.00 AND credit >= 0.00),
    CONSTRAINT fk_jel_entry FOREIGN KEY (journal_entry_id) REFERENCES journal_entries (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_jel_account FOREIGN KEY (account_id) REFERENCES chart_of_accounts (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. High-Performance Ledger Balances View (Source of Truth)
CREATE OR REPLACE VIEW view_account_balances AS
SELECT 
    coa.id,
    coa.account_code,
    coa.account_name,
    coa.account_category,
    coa.normal_balance,
    COALESCE(SUM(jel.debit), 0.00) AS total_debits,
    COALESCE(SUM(jel.credit), 0.00) AS total_credits,
    CASE 
        WHEN coa.normal_balance = 'debit' 
            THEN COALESCE(SUM(jel.debit), 0.00) - COALESCE(SUM(jel.credit), 0.00)
        ELSE 
            COALESCE(SUM(jel.credit), 0.00) - COALESCE(SUM(jel.debit), 0.00)
    END AS current_balance
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_category, coa.normal_balance;

-- 6. Daily Store Asset Snapshots Table
CREATE TABLE IF NOT EXISTS store_daily_asset_snapshots (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    business_date DATE NOT NULL,
    status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
    opening_liquid_assets DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    opening_inventory_value DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    opening_non_current_assets DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    opening_total_assets DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    closing_liquid_assets DECIMAL(14,2) NULL,
    closing_inventory_value DECIMAL(14,2) NULL,
    closing_non_current_assets DECIMAL(14,2) NULL,
    closing_total_assets DECIMAL(14,2) NULL,
    gross_sales DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    discounts_granted DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    net_sales DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    cogs_consumed DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    gross_profit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    operating_expenses DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    net_operating_profit DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    capital_injections DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    owner_withdrawals DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    drawer_variance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    spoilage_shrinkage DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_asset_delta DECIMAL(14,2) NULL,
    notes VARCHAR(500) NULL,
    opened_by BIGINT UNSIGNED NOT NULL,
    closed_by BIGINT UNSIGNED NULL,
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_store_daily_date (business_date),
    KEY idx_asset_snap_status (status),
    CONSTRAINT fk_snap_opened_by FOREIGN KEY (opened_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_snap_closed_by FOREIGN KEY (closed_by) REFERENCES users (id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
