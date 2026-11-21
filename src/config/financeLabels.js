// Every word the Finance page shows lives here, so wording is changed in one place.
// `label` is plain language for the owner. `term` is the accounting name, kept as a tooltip
// so the proper term is still there for an accountant (or a panel) to see.

export const FIN_TABS = {
  recon: { label: "Daily Cash & Stock Check", term: "Daily Asset Reconciliation" },
  pnl: { label: "Profit Report", term: "Profit & Loss (P&L), Income Statement" },
  cashflow: { label: "Money In & Out", term: "Cash Flow Statement" },
  balancesheet: { label: "What We Own & Owe", term: "Balance Sheet" },
  journal: { label: "Transaction History", term: "Journal Audit, General Journal" },
};

export const FIN_ACTIONS = {
  expense: { label: "Record an Expense", term: "Operating Expense" },
  wear: { label: "Equipment Wear & Tear", term: "Depreciation" },
  tax: { label: "Income Tax", term: "Income Tax Expense" },
  withdrawal: { label: "Owner Withdrawal", term: "Owner Drawing" },
  capital: { label: "Add Owner's Money", term: "Capital Injection" },
  transfer: { label: "Move Money Between Accounts", term: "Fund Transfer" },
  equipment: { label: "Buy Equipment", term: "Fixed Asset Purchase" },
  vat: { label: "Pay VAT to BIR", term: "VAT Remittance (Output VAT Payable)" },
};

export const FIN_RECON_COLUMNS = [
  { label: "Business Date" },
  { label: "Shift Status" },
  { label: "Value at Opening", term: "BOD Open Assets (beginning of day)" },
  { label: "Value at Closing", term: "EOD Close Assets (end of day)" },
  { label: "Change in Value Today", term: "Net Asset Delta" },
  { label: "Total Sales", term: "Gross Sales" },
  { label: "Cost of Ingredients Sold", term: "COGS (Cost of Goods Sold)" },
  { label: "Profit", term: "Net Profit" },
  { label: "Cash Drawer Over/Short", term: "Drawer Variance" },
  { label: "Shift Opened / Closed By" },
];

// Journal entry types as stored in the database, in words.
const ENTRY_TYPE_LABELS = {
  operating_expense: "Expense",
  capital_injection: "Owner's money added",
  owner_withdrawal: "Owner withdrawal",
  account_transfer: "Moved between accounts",
  adjustment: "Adjustment",
  inventory_restock: "Stock purchase",
  opening_balance: "Opening balance",
  ap_settlement: "Paid a bill",
  depreciation: "Equipment wear & tear",
  income_tax: "Income tax",
  equipment_purchase: "Equipment bought",
  void_reversal: "Cancellation",
};

export function entryTypeLabel(type) {
  const key = String(type || "");
  if (ENTRY_TYPE_LABELS[key]) return ENTRY_TYPE_LABELS[key];
  const spaced = key.replace(/_/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : "Other";
}

// Strings the static UI test looks for, so a rename here cannot silently drop a P&L row.
export const PNL_TERMS = {
  profitBeforeTax: { label: "Profit Before Tax", term: "Net Income Before Tax (NIBT)" },
  netIncome: { label: "NET INCOME", term: "Your final profit for the period" },
};

// Cash drawer over/short limits come from the settings (see shared/drawerThresholds.js).
export { drawerVarianceStatus } from "../../shared/drawerThresholds.js";

export function monthLabel(month) {
  const [year, mm] = String(month).split("-").map(Number);
  if (!year || !mm) return String(month);
  return new Date(Date.UTC(year, mm - 1, 1)).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
}
