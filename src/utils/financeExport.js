// Turns what the Finance page already loaded into CSV rows, using the same plain wording as the screen.
// Hidden figures (Net Income PIN locked) stay blank in the file.
import { entryTypeLabel, FIN_RECON_COLUMNS } from "../config/financeLabels.js";

const num = (value) => (value === null || value === undefined || value === "" ? "" : Number(value));

export function reconRows(items = []) {
  return [
    FIN_RECON_COLUMNS.map((col) => col.label),
    ...items.map((row) => [
      row.businessDate,
      row.status === "open" ? "Open" : "Closed",
      num(row.openingTotalAssets),
      num(row.closingTotalAssets),
      num(row.netAssetDelta),
      num(row.grossSales),
      num(row.cogsConsumed),
      num(row.netOperatingProfit),
      num(row.drawerVariance),
      `${row.openedByName || "System"}${row.closedByName ? ` / ${row.closedByName}` : ""}`,
    ]),
  ];
}

export function journalRows(entries = []) {
  const rows = [["Reference", "Date", "What It Was", "Description", "Account", "Direction", "Amount", "Recorded By", "Status"]];
  for (const entry of entries) {
    const status = entry.isReversal ? "Cancellation" : entry.isAlreadyReversed ? "Cancelled" : "";
    for (const line of entry.lines || []) {
      const goesTo = Number(line.debit) > 0;
      rows.push([
        entry.entryNumber,
        entry.entryDate ? String(entry.entryDate).slice(0, 19).replace("T", " ") : "",
        entryTypeLabel(entry.entryType),
        entry.memo || "",
        line.accountName,
        entry.amountsLocked ? "" : goesTo ? "Goes to" : "Comes from",
        entry.amountsLocked ? "" : num(goesTo ? line.debit : line.credit),
        entry.creatorName || "System",
        status,
      ]);
    }
  }
  return rows;
}

export function profitReportRows(pnl) {
  if (!pnl) return [["Item", "Amount"]];
  const rows = [["Item", "Amount"]];
  const add = (label, value) => rows.push([label, num(value)]);
  add("Total Sales (before VAT)", pnl.grossSales);
  add("Less: Discounts & Promos", pnl.discounts);
  add("Sales After Discounts", pnl.netSales);
  add("Less: Cost of Ingredients Sold", pnl.cogs);
  add("Profit After Ingredients", pnl.grossProfit);
  for (const group of pnl.usarGroups || []) {
    add(group.label, group.amount);
    for (const account of group.accounts || []) add(`   ${account.accountName}`, account.amount);
  }
  add("Ingredients + Staff Pay (Prime Cost)", pnl.primeCost);
  add("Profit Before Rent & Building Costs", pnl.controllableIncome);
  add("Operating Profit, Before Equipment Wear & Tear", pnl.ebitdaOperatingIncome);
  add("Less: Equipment Wear & Tear", pnl.depreciation);
  add("Profit Before Tax", pnl.netIncomeBeforeTax);
  add("Less: Income Tax", pnl.tax);
  add("NET INCOME", pnl.netIncome);
  return rows;
}

export function cashFlowRows(cf) {
  const rows = [["Item", "Amount"]];
  if (!cf) return rows;
  const op = cf.operatingActivities || {};
  const inv = cf.investingActivities || {};
  const fin = cf.financingActivities || {};
  const add = (label, value) => rows.push([label, num(value)]);
  add("Sales Received (cash & wallets)", op.cashSalesInflow);
  add("Other Cash In / Out (net)", op.otherOperatingCashNet);
  add("Less: Stock Bought with Cash", op.restockCashOutflow);
  add("Less: Expenses Paid", op.opexCashOutflow);
  add("Less: Income Tax Paid", op.taxCashOutflow);
  add("Cash from Daily Business", op.netOperatingCashFlow);
  add("Equipment & Fixtures Bought with Cash", inv.equipmentPurchased);
  add("Cash Spent on Equipment", inv.netInvestingCashFlow);
  add("Owner Put In (opening & added money)", fin.capitalInjected);
  add("Less: Owner Withdrawals", fin.drawingsWithdrawn);
  add("Net Owner's Money", fin.netFinancingCashFlow);
  add("Total Change in Cash & Bank Balances", cf.netCashFlow);
  return rows;
}

export function balanceSheetRows(bs) {
  const rows = [["Section", "Item", "Amount"]];
  if (!bs) return rows;
  rows.push(["As of", bs.asOfDate || "", ""]);
  for (const a of bs.assets?.current || []) rows.push(["What We Own", a.accountName, num(a.amount)]);
  for (const a of bs.assets?.nonCurrent || []) rows.push(["What We Own", a.accountName, a.isContra ? -Math.abs(Number(a.amount)) : num(a.amount)]);
  rows.push(["What We Own", "TOTAL WE OWN", num(bs.totalAssets)]);
  for (const l of bs.liabilities?.current || []) rows.push(["What We Owe", l.accountName, num(l.amount)]);
  rows.push(["Owner's Share", "Owner's Money Put In", num(bs.equity?.capital)]);
  rows.push(["Owner's Share", "Less: Owner Withdrawals", num(bs.equity?.drawings)]);
  rows.push(["Owner's Share", "Store Earnings Kept", num(bs.equity?.retainedEarnings)]);
  return rows;
}
