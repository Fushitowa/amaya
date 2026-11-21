-- Migration 052: Inventory shrinkage account (6031).
-- Stock-count corrections used to land in 6030 Waste Cost (when stock went down) or in 3010 Owner's
-- Capital (when stock went up). Under IAS 2 / US GAAP practice, the difference between what the books
-- say and what a physical count finds is inventory shrinkage (or overage), a cost of sales item that is
-- kept apart from logged waste. Owner's equity should never move because of a recount.
INSERT INTO chart_of_accounts (
  account_code,
  account_name,
  account_category,
  normal_balance,
  is_system_locked,
  report_section,
  expense_group
)
VALUES
  ('6031', 'Inventory Shrinkage & Overage', 'expense', 'debit', TRUE, 'cogs', NULL)
ON DUPLICATE KEY UPDATE
  account_name = VALUES(account_name),
  account_category = VALUES(account_category),
  normal_balance = VALUES(normal_balance),
  report_section = VALUES(report_section),
  expense_group = VALUES(expense_group);
