import { EXPENSE_REPORT_SECTIONS, PAYROLL_EXPENSE_ACCOUNT_CODES } from "../../../config/expenseNavigation.js";

// Expense accounts a manual entry may use: controllable OPEX and occupancy, minus payroll and the
// shift-close cash over/short account.
export const isManualExpenseAccount = (a) =>
  EXPENSE_REPORT_SECTIONS.includes(a.reportSection) && !PAYROLL_EXPENSE_ACCOUNT_CODES.includes(a.accountCode) && a.accountCode !== "6040";
