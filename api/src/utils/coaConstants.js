/**
 * Centralized Chart of Accounts (COA) constants and Balance Sheet display labels.
 */

export const LIQUID_ACCOUNT_CODES = new Set(["1010", "1020", "1030", "1040"]);

export const BS_LABELS = {
  "1010": "Cash Drawer (Counter 1)",
  "1020": "GCash Official Wallet",
  "1030": "Store Bank Account",
  "1040": "Owner Capital Reserve",
  "1050": "Merchandise Inventory (Ledger)",
  "1510": "Kitchen & Espresso Equipment",
  "1520": "Less: Accumulated Depreciation",
  "2010": "Accounts Payable (Suppliers)",
  "2020": "2020 - Sales Tax / VAT Payable (Collected on Orders)",
  "2030": "Income Tax Payable",
  "2040": "Salaries & Wages Payable",
  "2045": "13th Month Pay Payable",
  "2050": "SSS / PhilHealth / Pag-IBIG Payable",
  "2060": "Withholding Tax on Compensation Payable",
};

// Liabilities owned by Payroll Runs. Manual journal entries may not post to them.
export const PAYROLL_LIABILITY_ACCOUNT_CODES = Object.freeze(["2040", "2045", "2050", "2060"]);
