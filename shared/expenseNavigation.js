// Grouped to the Uniform System of Accounts for Restaurants (USAR): Labor; controllable costs
// (Utilities, Marketing, Operating Supplies, Repairs, G&A); then non-controllable Occupancy.
// A category's first account is where a new record for it is posted.
// `readOnly` pages list ledger records that other screens post (no manual entry).
export const EXPENSE_NAV_CATEGORIES = Object.freeze([
  { slug: "labor-and-payroll", label: "Labor and Payroll", accountCodes: ["6111", "6115", "6116", "6112", "6114", "6113"] },
  { slug: "salary", label: "Salary", accountCodes: ["6111"] },
  { slug: "wages", label: "Wages", accountCodes: ["6115"] },
  { slug: "overtime", label: "Overtime", accountCodes: ["6116"] },
  { slug: "government-contributions", label: "Government Contributions", accountCodes: ["6112"] },
  { slug: "thirteenth-month", label: "13th Month Pay", accountCodes: ["6114"] },
  { slug: "staff-meals", label: "Staff Meals", accountCodes: ["6113"] },
  { slug: "utilities", label: "Utilities", accountCodes: ["6130", "6131", "6132", "6133", "6135", "6020"] },
  { slug: "electricity", label: "Electricity", accountCodes: ["6131"], utility: { unit: "kWh", providerHint: "Meralco or electric cooperative" } },
  { slug: "water", label: "Water", accountCodes: ["6132"], utility: { unit: "m3", providerHint: "Water district or concessionaire" } },
  { slug: "lpg", label: "LPG", accountCodes: ["6133"], utility: { unit: "kg", providerHint: "LPG supplier" } },
  { slug: "trash-collection", label: "Trash Collection", accountCodes: ["6135"], utility: { unit: null, providerHint: "Barangay or hauler" } },
  { slug: "other-utilities", label: "Other Utilities", accountCodes: ["6130", "6020"], accountNote: "General utilities, plus older records from before utilities were split into categories." },
  { slug: "marketing", label: "Marketing", accountCodes: ["6150"] },
  { slug: "operating-supplies", label: "Operating Supplies", accountCodes: ["6140", "6141", "6142", "6143", "6144"] },
  { slug: "kitchen-tools", label: "Kitchen Tools", accountCodes: ["6143"] },
  { slug: "sanitation-supplies", label: "Sanitation Supplies", accountCodes: ["6144"] },
  { slug: "other-operating-supplies", label: "Other Operating Supplies", accountCodes: ["6140", "6141", "6142"] },
  { slug: "repairs-and-maintenance", label: "Repairs and Maintenance", accountCodes: ["6160"] },
  { slug: "maintenance-expenses", label: "Maintenance Expenses", accountCodes: ["6160"], accountNote: "Part of Repairs and Maintenance. Older records with no category are counted here." },
  { slug: "labor-for-repairs", label: "Labor for Repairs (e.g., plumbing or water repairs)", accountCodes: ["6160"], accountNote: "Part of Repairs and Maintenance. Only records tagged Labor for Repairs are counted here." },
  { slug: "general-and-administrative", label: "General and Administrative", accountCodes: ["6171", "6172", "6134", "6040", "6173", "6174", "6179"] },
  { slug: "office-expenses", label: "Office Expenses", accountCodes: ["6171"] },
  { slug: "taxes-and-licenses", label: "Taxes and Licenses", accountCodes: ["6172"] },
  { slug: "internet", label: "Telephone & Internet", accountCodes: ["6134"] },
  { slug: "cash-over-short", label: "Cash Over/Short", accountCodes: ["6040"], readOnly: true, accountNote: "Posted automatically when a cashier closes a shift with a shortage (cost) or overage (reduces it)." },
  { slug: "professional-and-bank-fees", label: "Professional and Bank Fees", accountCodes: ["6173"] },
  { slug: "transportation", label: "Transportation", accountCodes: ["6174"] },
  { slug: "miscellaneous", label: "Miscellaneous", accountCodes: ["6179", "6010"] },
  { slug: "occupancy", label: "Occupancy", accountCodes: ["6120", "6125"] },
  { slug: "rent", label: "Rent", accountCodes: ["6120"] },
  { slug: "building-insurance-and-taxes", label: "Building Insurance & Taxes", accountCodes: ["6125"] },
]);

// How categories are grouped (sidebar folders, budget board sections). A node with children is a
// group: its spend is its own tagged records plus the sum of its children, never counted twice.
export const EXPENSE_NAV_TREE = Object.freeze([
  { slug: "labor-and-payroll", children: ["salary", "wages", "overtime", "government-contributions", "thirteenth-month", "staff-meals"] },
  { slug: "utilities", children: ["electricity", "water", "lpg", "trash-collection", "other-utilities"] },
  { slug: "marketing", children: [] },
  { slug: "operating-supplies", children: ["kitchen-tools", "sanitation-supplies", "other-operating-supplies"] },
  { slug: "repairs-and-maintenance", children: ["maintenance-expenses", "labor-for-repairs"] },
  { slug: "general-and-administrative", children: ["office-expenses", "taxes-and-licenses", "internet", "cash-over-short"] },
  { slug: "professional-and-bank-fees", children: [] },
  { slug: "transportation", children: [] },
  { slug: "miscellaneous", children: [] },
  { slug: "occupancy", children: ["rent", "building-insurance-and-taxes"] },
]);

// Expense sections of the chart of accounts: controllable operating expenses and occupancy.
export const EXPENSE_REPORT_SECTIONS = Object.freeze(["opex", "occupancy"]);

// Accounts whose ledger entries come from somewhere other than an operating_expense record
// (shift close posts 6040; inventory adjustments post 6010). Their net (debit − credit) counts.
export const ADJUSTMENT_EXPENSE_ACCOUNT_CODES = Object.freeze(["6040", "6010"]);

export function getUtilityCategories() {
  return EXPENSE_NAV_CATEGORIES.filter((category) => category.utility);
}

// Ledger accounts that only payroll may post to (manual expense entry is blocked in Phase 2).
export const PAYROLL_EXPENSE_ACCOUNT_CODES = Object.freeze(["6111", "6112", "6114", "6115", "6116"]);

export function getExpenseNavCategory(slug) {
  return EXPENSE_NAV_CATEGORIES.find((category) => category.slug === slug) || null;
}

export function getExpenseChildSlugs(slug) {
  return EXPENSE_NAV_TREE.find((node) => node.slug === slug)?.children || [];
}

const PARENT_SLUGS = new Set(EXPENSE_NAV_TREE.filter((node) => node.children.length).map((node) => node.slug));

// Older records carry no category tag, only a ledger account. Each such account belongs to exactly
// one category: the first page-level (leaf) category that lists it, otherwise the first group that
// lists it. That way an untagged record is counted once, never on every page sharing the account.
export const LEGACY_ACCOUNT_OWNER = Object.freeze((() => {
  const owner = {};
  const assign = (category) => {
    for (const code of category.accountCodes) {
      if (!(code in owner)) owner[code] = category.slug;
    }
  };
  EXPENSE_NAV_CATEGORIES.filter((category) => !PARENT_SLUGS.has(category.slug)).forEach(assign);
  EXPENSE_NAV_CATEGORIES.filter((category) => PARENT_SLUGS.has(category.slug)).forEach(assign);
  return owner;
})());

/**
 * What a category's totals and record list include: records tagged with the category or one of
 * its children, plus untagged records on the accounts this category (or a child) owns.
 */
export function getExpenseCategoryScope(slug) {
  const slugs = [slug, ...getExpenseChildSlugs(slug)];
  const slugSet = new Set(slugs);
  const legacyAccountCodes = Object.entries(LEGACY_ACCOUNT_OWNER)
    .filter(([, owner]) => slugSet.has(owner))
    .map(([code]) => code);
  return { slugs, legacyAccountCodes };
}
