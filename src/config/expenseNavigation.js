export const EXPENSE_NAV_CATEGORIES = Object.freeze([
  { slug: "labor-and-payroll", label: "Labor and Payroll", accountCodes: ["6111", "6112", "6113"] },
  { slug: "salary", label: "Salary", accountCodes: ["6111"], accountNote: "Salary, wages, and overtime share the current 6111 payroll account." },
  { slug: "wages", label: "Wages", accountCodes: ["6111"], accountNote: "Salary, wages, and overtime share the current 6111 payroll account." },
  { slug: "overtime", label: "Overtime", accountCodes: ["6111"], accountNote: "Salary, wages, and overtime share the current 6111 payroll account." },
  { slug: "staff-meals", label: "Staff Meals", accountCodes: ["6113"] },
  { slug: "utilities", label: "Utilities", accountCodes: ["6020", "6130", "6131", "6132", "6133", "6134"] },
  { slug: "electricity", label: "Electricity", accountCodes: ["6131"] },
  { slug: "water", label: "Water", accountCodes: ["6132"] },
  { slug: "lpg", label: "LPG", accountCodes: ["6133"] },
  { slug: "internet", label: "Internet", accountCodes: ["6134"] },
  { slug: "operating-supplies", label: "Operating Supplies", accountCodes: ["6140", "6141", "6142", "6143", "6144"] },
  { slug: "kitchen-tools", label: "Kitchen Tools", accountCodes: ["6143"] },
  { slug: "sanitation-supplies", label: "Sanitation Supplies", accountCodes: ["6144"] },
  { slug: "other-operating-supplies", label: "Other Operating Supplies", accountCodes: ["6140", "6141", "6142"] },
  { slug: "repairs-and-maintenance", label: "Repairs and Maintenance", accountCodes: ["6160"] },
  { slug: "maintenance-expenses", label: "Maintenance Expenses", accountCodes: ["6160"], accountNote: "Maintenance expenses currently use the shared 6160 Repairs & Maintenance account." },
  { slug: "labor-for-repairs", label: "Labor for Repairs (e.g., plumbing or water repairs)", accountCodes: ["6160"], accountNote: "Repair labor is currently recorded under the shared 6160 Repairs & Maintenance account." },
  { slug: "general-and-administrative", label: "General and Administrative", accountCodes: ["6171", "6172", "6173", "6174", "6179"] },
  { slug: "office-expenses", label: "Office Expenses", accountCodes: ["6171"] },
  { slug: "taxes-and-licenses", label: "Taxes and Licenses", accountCodes: ["6172"] },
  { slug: "professional-and-bank-fees", label: "Professional and Bank Fees", accountCodes: ["6173"] },
  { slug: "transportation", label: "Transportation", accountCodes: ["6174"] },
  { slug: "miscellaneous", label: "Miscellaneous", accountCodes: ["6179"] },
]);

export function getExpenseNavCategory(slug) {
  return EXPENSE_NAV_CATEGORIES.find((category) => category.slug === slug) || null;
}
