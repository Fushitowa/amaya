/**
 * One definition of "cash that left (or came into) the drawer during a shift", shared by shift
 * close, the live shift view and the staff report so every expected-cash figure agrees.
 *
 * Expected cash = opening float + paid cash sales - net drawer spending posted to account 1010
 * by the entry types below while the shift was open. Sales are counted from orders (not the
 * ledger) and drawer over/short adjustments are excluded, so neither is counted twice.
 */
export const DRAWER_SPEND_ENTRY_TYPES = Object.freeze([
  "inventory_restock",
  "operating_expense",
  "ap_settlement",
  "income_tax",
  "owner_withdrawal",
  "capital_injection",
  "account_transfer",
  "equipment_purchase",
]);

export const DRAWER_SPEND_FILTER_SQL = `(
  je.entry_type IN (${DRAWER_SPEND_ENTRY_TYPES.map((type) => `'${type}'`).join(", ")})
  OR (je.entry_type = 'void_reversal' AND je.order_id IS NULL)
)`;

/** LEFT JOIN exposing `rs.cash_restocks` (net drawer spending) per cashier session `cs`. */
export const SESSION_DRAWER_SPEND_JOIN_SQL = `
  LEFT JOIN (
    SELECT je.session_id,
           COALESCE(SUM(jel.credit - jel.debit), 0.00) AS cash_restocks
      FROM journal_entries je
      JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
      JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE je.session_id IS NOT NULL
       AND coa.account_code = '1010'
       AND ${DRAWER_SPEND_FILTER_SQL}
     GROUP BY je.session_id
  ) rs ON rs.session_id = cs.id`;

export function computeExpectedCash({ openingFloat = 0, cashSales = 0, drawerSpend = 0 } = {}) {
  return Number((Number(openingFloat || 0) + Number(cashSales || 0) - Number(drawerSpend || 0)).toFixed(2));
}
