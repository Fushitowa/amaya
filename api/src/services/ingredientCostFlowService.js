import pool from "../database.js";
import { httpError } from "../middleware/auth.js";
import { getManilaDateString, isValidIsoDateOnly } from "../../../shared/manilaDate.js";
import { getWasteKind, getWasteReasonMeta, round2 } from "../../../shared/wasteMeasurement.js";

function firstOfMonth(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

function percentOf(value, base) {
  return base > 0 ? round2((value / base) * 100) : null;
}

/**
 * Follows the ingredient money for one period, straight from the ledger, in the layout
 * restaurants use (actual vs theoretical food cost):
 *
 *   Opening stock + Bought = Sold in drinks + Waste + Store use + Shrinkage + Closing stock
 *
 *  - Theoretical food cost  = recipe cost of what was sold (5010).
 *  - Actual food cost       = recipe cost + waste (6030) + shrinkage found at recounts (6031).
 *  - Bought is worked out from the other lines, so the table always adds up.
 */
export async function getIngredientCostFlow({ from, to } = {}) {
  const today = getManilaDateString();
  const end = isValidIsoDateOnly(to) ? to : today;
  const start = isValidIsoDateOnly(from) ? from : firstOfMonth(end);
  if (start > end) {
    throw httpError(400, "The start date must be on or before the end date.");
  }

  // entry_date is a DATETIME, so day edges must carry a time.
  const startAt = `${start} 00:00:00`;
  const endAt = `${end} 23:59:59`;

  const [[balances]] = await pool.execute(
    `SELECT
        COALESCE(SUM(CASE WHEN je.entry_date < ? THEN jel.debit - jel.credit ELSE 0 END), 0) AS opening,
        COALESCE(SUM(CASE WHEN je.entry_date <= ? THEN jel.debit - jel.credit ELSE 0 END), 0) AS closing
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE coa.account_code = '1050'`,
    [startAt, endAt],
  );

  const [accountRows] = await pool.execute(
    `SELECT coa.account_code, coa.report_section, SUM(jel.debit - jel.credit) AS net_debit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.entry_date BETWEEN ? AND ?
        AND (coa.account_code IN ('5010', '6030', '6031') OR coa.report_section IN ('revenue', 'contra_revenue'))
      GROUP BY coa.account_code, coa.report_section`,
    [startAt, endAt],
  );
  let soldCost = 0;
  let waste = 0;
  let shrinkage = 0;
  let grossSales = 0;
  let discounts = 0;
  for (const row of accountRows) {
    const net = Number(row.net_debit || 0);
    if (row.account_code === "5010") soldCost += net;
    else if (row.account_code === "6030") waste += net;
    else if (row.account_code === "6031") shrinkage += net;
    else if (row.report_section === "revenue") grossSales += -net;
    else if (row.report_section === "contra_revenue") discounts += net;
  }

  const [[storeUseRow]] = await pool.execute(
    `SELECT COALESCE(SUM(jel.credit - jel.debit), 0) AS store_use
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       JOIN inventory_movements m ON m.id = je.inventory_movement_id
      WHERE coa.account_code = '1050'
        AND m.movement_type = 'internal_use'
        AND je.entry_date BETWEEN ? AND ?`,
    [startAt, endAt],
  );

  const [reasonRows] = await pool.execute(
    `SELECT m.waste_reason, COUNT(*) AS events, COALESCE(SUM(COALESCE(m.batch_cost, 0)), 0) AS total_value
       FROM inventory_movements m
      WHERE m.movement_type = 'spoilage'
        AND m.order_id IS NULL
        AND m.waste_reason IS NOT NULL
        AND m.reversed_by_movement_id IS NULL
        AND m.created_at >= ?
        AND m.created_at <= ?
      GROUP BY m.waste_reason
      ORDER BY total_value DESC`,
    [startAt, endAt],
  );

  const opening = round2(balances?.opening);
  const closing = round2(balances?.closing);
  const soldInDrinks = round2(soldCost);
  const wasteCost = round2(waste);
  const storeUse = round2(storeUseRow?.store_use);
  const shrinkageCost = round2(shrinkage);
  const bought = round2(closing - opening + soldInDrinks + wasteCost + storeUse + shrinkageCost);
  const netSales = round2(grossSales - discounts);

  const byReason = reasonRows.map((row) => ({
    reason: row.waste_reason,
    label: getWasteReasonMeta(row.waste_reason).label,
    kind: getWasteKind(row.waste_reason),
    events: Number(row.events || 0),
    value: round2(row.total_value),
  }));
  const loggedWaste = round2(byReason.reduce((sum, row) => sum + row.value, 0));
  // Whatever Waste Cost the logs do not explain came from voided orders marked as spoilage.
  const voidedOrderWaste = round2(Math.max(0, wasteCost - loggedWaste));
  const normalWaste = round2(byReason.filter((row) => row.kind === "normal").reduce((sum, row) => sum + row.value, 0));

  const theoreticalFoodCost = soldInDrinks;
  const actualFoodCost = round2(soldInDrinks + wasteCost + shrinkageCost);

  return {
    from: start,
    to: end,
    flow: { opening, bought, soldInDrinks, waste: wasteCost, storeUse, shrinkage: shrinkageCost, closing },
    netSales,
    foodCost: {
      theoretical: theoreticalFoodCost,
      actual: actualFoodCost,
      theoreticalPercent: percentOf(theoreticalFoodCost, netSales),
      actualPercent: percentOf(actualFoodCost, netSales),
      gap: round2(actualFoodCost - theoreticalFoodCost),
    },
    waste: {
      total: wasteCost,
      percentOfSales: percentOf(wasteCost, netSales),
      percentOfFoodCost: percentOf(wasteCost, actualFoodCost),
      normal: normalWaste,
      avoidable: round2(Math.max(0, wasteCost - normalWaste)),
      voidedOrders: voidedOrderWaste,
      byReason,
    },
  };
}
