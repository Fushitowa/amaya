-- Waste Cost is a COGS account sourced from inventory movements, never an OPEX category.
UPDATE chart_of_accounts
   SET account_name = 'Waste Cost',
       report_section = 'cogs',
       expense_group = NULL
 WHERE account_code = '6030';
