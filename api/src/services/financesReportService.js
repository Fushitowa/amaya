import pool from "../database.js";
import {
  round2,
  getManilaDateString,
  assertValidDateRange,
  parseBoundedPositiveInt,
  summarizeIncomeStatementLines,
} from "../utils/ledgerService.js";
import { LIQUID_ACCOUNT_CODES, BS_LABELS } from "../utils/coaConstants.js";
import { formatDbDateOnly } from "../../../shared/manilaDate.js";

export function summarizeBalanceSheetAccounts(accounts = []) {
  const accountMap = new Map();
  const currentAssets = [];
  const nonCurrentAssets = [];
  const currentLiabilities = [];

  let totalCurrentAssets = 0;
  let grossEquipment = 0;
  let accumulatedDepreciation = 0;
  let netEquipment = 0;
  let totalLiabilities = 0;

  for (const acc of accounts) {
    const code = String(acc.account_code);
    const bal = round2(acc.current_balance);
    accountMap.set(code, bal);
    if (acc.report_section !== "balance_sheet") continue;

    if (acc.account_category === "asset") {
      const isContra = String(acc.normal_balance).toLowerCase() === "credit";
      const signed = isContra ? -bal : bal;
      if (LIQUID_ACCOUNT_CODES.has(code) || code === "1050") {
        currentAssets.push({
          accountCode: code,
          accountName: BS_LABELS[code] || acc.account_name,
          amount: bal,
        });
        totalCurrentAssets += signed;
      } else {
        nonCurrentAssets.push({
          accountCode: code,
          accountName: BS_LABELS[code] || acc.account_name,
          amount: bal,
          ...(isContra ? { isContra: true } : {}),
        });
        if (isContra) accumulatedDepreciation += bal;
        else grossEquipment += bal;
        netEquipment += signed;
      }
    } else if (acc.account_category === "liability") {
      const isCreditNormal = String(acc.normal_balance).toLowerCase() === "credit";
      const signed = isCreditNormal ? bal : -bal;
      currentLiabilities.push({
        accountCode: code,
        accountName: BS_LABELS[code] || acc.account_name,
        amount: signed,
      });
      totalLiabilities += signed;
    }
  }

  const roundedGrossEquip = round2(grossEquipment);
  const roundedAccumDepr = round2(accumulatedDepreciation);
  const roundedNetEquip = round2(netEquipment);
  const roundedTotalCurrent = round2(totalCurrentAssets);

  return {
    accountMap,
    currentAssets,
    nonCurrentAssets,
    grossEquipment: roundedGrossEquip,
    accumulatedDepreciation: roundedAccumDepr,
    netEquipment: roundedNetEquip,
    totalAssets: round2(roundedTotalCurrent + roundedNetEquip),
    currentLiabilities,
    totalLiabilities: round2(totalLiabilities),
    ownerCapital: accountMap.get("3010") || 0.00,
    ownerDrawings: accountMap.get("3020") || 0.00,
  };
}

const ACTIVE_COA_VIEW_SQL = `
  SELECT coa.id,
         coa.account_code,
         coa.account_name,
         coa.account_category,
         coa.normal_balance,
         coa.report_section,
         coa.expense_group,
         COALESCE(v.total_debits, 0.00) AS total_debits,
         COALESCE(v.total_credits, 0.00) AS total_credits,
         COALESCE(v.current_balance, 0.00) AS current_balance
    FROM chart_of_accounts coa
    LEFT JOIN view_account_balances v ON v.id = coa.id
   WHERE coa.is_active = TRUE
   ORDER BY coa.account_code ASC`;

export async function getTrialBalanceReport() {
  const [rows] = await pool.query(ACTIVE_COA_VIEW_SQL);

  let totalDebits = 0;
  let totalCredits = 0;
  for (const row of rows) {
    totalDebits += Number(row.total_debits || 0);
    totalCredits += Number(row.total_credits || 0);
  }

  const roundedDebits = round2(totalDebits);
  const roundedCredits = round2(totalCredits);
  const isBalanced = Math.abs(roundedDebits - roundedCredits) < 0.005;

  return {
    accounts: rows.map((r) => ({
      id: Number(r.id),
      accountCode: r.account_code,
      accountName: r.account_name,
      category: r.account_category,
      normalBalance: r.normal_balance,
      reportSection: r.report_section,
      expenseGroup: r.expense_group || null,
      totalDebits: round2(r.total_debits),
      totalCredits: round2(r.total_credits),
      currentBalance: round2(r.current_balance),
    })),
    totalDebits: roundedDebits,
    totalCredits: roundedCredits,
    isBalanced,
  };
}

export async function getAccountsAndAssetsReport(rawFrom, rawTo) {
  const { from, to } = assertValidDateRange(rawFrom, rawTo);
  const [accounts] = await pool.query(ACTIVE_COA_VIEW_SQL);

  const [[invRow]] = await pool.query(
    "SELECT COALESCE(SUM(quantity * unit_cost), 0.00) AS live_inventory_value FROM inventory_items WHERE is_archived = FALSE",
  );
  const liveInventoryValue = round2(invRow?.live_inventory_value);

  const [[[unconfirmedCashRow]], [[unconfirmedOrdRow]]] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0.00) AS unconfirmed_counter_cash
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
         JOIN orders o ON o.id = je.order_id
        WHERE coa.account_code = '1010'
          AND o.payment_status = 'Paid'
          AND o.order_status <> 'Cancelled'
          AND o.owner_confirmed_at IS NULL`,
    ),
    pool.query(
      `SELECT COUNT(*) AS unconfirmed_orders_count,
              COALESCE(SUM(o.total), 0.00) AS unconfirmed_sales_total
         FROM orders o
        WHERE o.payment_status = 'Paid'
          AND o.order_status <> 'Cancelled'
          AND o.owner_confirmed_at IS NULL`,
    ),
  ]);

  const bs = summarizeBalanceSheetAccounts(accounts);
  const cashDrawer = round2(bs.accountMap.get("1010") || 0.00);
  const unconfirmedCounterCash = round2(Math.max(0, Number(unconfirmedCashRow?.unconfirmed_counter_cash || 0)));
  const confirmedCashDrawer = round2(cashDrawer - unconfirmedCounterCash);
  const unconfirmedOrdersCount = Number(unconfirmedOrdRow?.unconfirmed_orders_count || 0);
  const unconfirmedSalesTotal = round2(unconfirmedOrdRow?.unconfirmed_sales_total || 0);
  const gcash = bs.accountMap.get("1020") || 0.00;
  const bank = bs.accountMap.get("1030") || 0.00;
  const reserve = bs.accountMap.get("1040") || 0.00;
  const nonCurrentEquipment = bs.netEquipment;
  const ledgerInventoryValue = round2(bs.accountMap.get("1050") || 0.00);
  const inventoryValuationVariance = round2(liveInventoryValue - ledgerInventoryValue);

  const totalConfirmedMoney = round2(confirmedCashDrawer + gcash + bank + reserve);
  const totalLiquidAssets = totalConfirmedMoney;
  const glTotalLiquidAssets = round2(cashDrawer + gcash + bank + reserve);
  const totalStoreAssets = round2(totalLiquidAssets + liveInventoryValue + nonCurrentEquipment);
  const totalLiabilities = bs.totalLiabilities;
  const ownerCapital = bs.ownerCapital;
  const ownerDrawings = bs.ownerDrawings;

  let pnlSource = accounts;
  if (from || to) {
    const conditions = ["coa.is_active = TRUE"];
    const params = [];
    if (from) {
      conditions.push("je.entry_date >= ?");
      params.push(`${from} 00:00:00`);
    }
    if (to) {
      conditions.push("je.entry_date <= ?");
      params.push(`${to} 23:59:59`);
    }
    const [periodLines] = await pool.query(
      `SELECT coa.account_code,
              coa.account_name,
              coa.account_category,
              coa.normal_balance,
              coa.report_section,
              coa.expense_group,
              COALESCE(SUM(jel.debit), 0.00) AS total_debit,
              COALESCE(SUM(jel.credit), 0.00) AS total_credit
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE ${conditions.join(" AND ")}
        GROUP BY coa.account_code, coa.account_name, coa.account_category, coa.normal_balance, coa.report_section, coa.expense_group`,
      params,
    );
    pnlSource = periodLines;
  }

  const allTimePnl = summarizeIncomeStatementLines(accounts, { clampSections: false });
  const pnl = (from || to) ? summarizeIncomeStatementLines(pnlSource, { clampSections: false }) : allTimePnl;
  const netSalesRevenue = pnl.netSales;
  const totalCogsAndExpenses = round2(pnl.cogs + pnl.totalOperatingExpenses + pnl.depreciation + pnl.tax);
  const netProfitAfterSale = pnl.netIncome;
  const preparedNetIncome = round2(pnl.grossProfit - pnl.totalOperatingExpenses);
  const baseCapitalMoney = round2(totalStoreAssets - allTimePnl.netIncome);
  const netEquityCapital = round2(ownerCapital - ownerDrawings);

  return {
    accounts: accounts.map((a) => ({
      id: Number(a.id),
      accountCode: a.account_code,
      accountName: a.account_name,
      category: a.account_category,
      normalBalance: a.normal_balance,
      reportSection: a.report_section,
      expenseGroup: a.expense_group || null,
      balance: round2(a.current_balance),
    })),
    summary: {
      cashDrawer,
      unconfirmedCounterCash,
      confirmedCashDrawer,
      unconfirmedOrdersCount,
      unconfirmedSalesTotal,
      gcash,
      bank,
      reserve,
      totalConfirmedMoney,
      totalLiquidAssets,
      glTotalLiquidAssets,
      liveInventoryValue,
      ledgerInventoryValue,
      inventoryValuationVariance,
      nonCurrentEquipment,
      totalStoreAssets,
      totalLiabilities,
      ownerCapital,
      ownerDrawings,
      netEquityCapital,
      allTimeNetProfit: allTimePnl.netIncome,
      baseCapitalMoney,
      netProfitAfterSale,
      netSalesRevenue,
      cogs: pnl.cogs,
      operatingExpenses: pnl.totalOperatingExpenses,
      totalOperatingExpenses: pnl.totalOperatingExpenses,
      netIncome: preparedNetIncome,
      customerSalesCogs: pnl.customerSalesCogs,
      foodSpoilageCogs: pnl.foodSpoilageCogs,
      wasteCost: pnl.foodSpoilageCogs,
      grossProfit: pnl.grossProfit,
      grossMarginPercent: pnl.grossMarginPercent,
      totalCogsAndExpenses,
      periodRange: {
        from: from || null,
        to: to || null,
      },
    },
  };
}

export async function getProfitAndLossReport(rawFrom, rawTo) {
  const { from, to } = assertValidDateRange(rawFrom, rawTo);
  const conditions = [];
  const params = [];

  if (from) {
    conditions.push("je.entry_date >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push("je.entry_date <= ?");
    params.push(`${to} 23:59:59`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [lines] = await pool.query(
    `SELECT coa.account_code,
            coa.account_name,
            coa.account_category,
            coa.normal_balance,
            coa.report_section,
            coa.expense_group,
            COALESCE(SUM(jel.debit), 0.00) AS total_debit,
            COALESCE(SUM(jel.credit), 0.00) AS total_credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       ${whereClause}
      GROUP BY coa.account_code, coa.account_name, coa.account_category, coa.normal_balance, coa.report_section, coa.expense_group`,
    params,
  );

  const pnl = summarizeIncomeStatementLines(lines, { clampSections: false });

  return {
    grossSales: pnl.grossSales,
    discounts: pnl.discounts,
    netSales: pnl.netSales,
    customerSalesCogs: pnl.customerSalesCogs,
    foodSpoilageCogs: pnl.foodSpoilageCogs,
    wasteCost: pnl.foodSpoilageCogs,
    cogs: pnl.cogs,
    grossProfit: pnl.grossProfit,
    grossMarginPercent: pnl.grossMarginPercent,
    operatingExpenses: pnl.operatingExpenses,
    totalOperatingExpenses: pnl.totalOperatingExpenses,
    depreciation: pnl.depreciation,
    tax: pnl.tax,
    ebitdaOperatingIncome: pnl.ebitdaOperatingIncome,
    netIncomeBeforeTax: pnl.netIncomeBeforeTax,
    netIncome: round2(pnl.grossProfit - pnl.totalOperatingExpenses),
    accountingNetIncome: pnl.netIncome,
    netOperatingProfit: pnl.netOperatingProfit,
  };
}

export async function getCashFlowReport(rawFrom, rawTo) {
  const { from, to } = assertValidDateRange(rawFrom, rawTo);
  const conditions = [
    `EXISTS (
      SELECT 1
        FROM journal_entry_lines jel_liq
        JOIN chart_of_accounts coa_liq ON coa_liq.id = jel_liq.account_id
       WHERE jel_liq.journal_entry_id = je.id
         AND coa_liq.account_code IN ('1010', '1020', '1030', '1040')
    )`,
  ];
  const params = [];

  if (from) {
    conditions.push("je.entry_date >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push("je.entry_date <= ?");
    params.push(`${to} 23:59:59`);
  }
  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const [[aggRow]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE
         WHEN e.effective_type <> 'opening_balance' AND e.has_1510 = 1 AND e.has_1050 = 0 AND e.has_3010 = 0 AND e.has_3020 = 0 THEN 0
         WHEN e.effective_type IN ('capital_injection', 'opening_balance') THEN 0
         WHEN e.effective_type = 'owner_withdrawal' THEN 0
         WHEN e.effective_type = 'sales_revenue' THEN e.liquid_net
         ELSE 0
       END), 0.00) AS cash_sales_inflow,
       COALESCE(SUM(CASE
         WHEN e.effective_type <> 'opening_balance' AND e.has_1510 = 1 AND e.has_1050 = 0 AND e.has_3010 = 0 AND e.has_3020 = 0 THEN 0
         WHEN e.effective_type IN ('capital_injection', 'opening_balance', 'owner_withdrawal', 'sales_revenue') THEN 0
         WHEN e.effective_type = 'operating_expense' THEN -e.liquid_net
         WHEN e.effective_type = 'ap_settlement'
          AND COALESCE(e.payable_bill_category, '') NOT IN ('inventory_restock', 'income_tax')
          AND NOT (e.payable_bill_category IS NULL AND e.has_2030 = 1) THEN -e.liquid_net
         ELSE 0
       END), 0.00) AS opex_cash_outflow,
       COALESCE(SUM(CASE
         WHEN e.effective_type <> 'opening_balance' AND e.has_1510 = 1 AND e.has_1050 = 0 AND e.has_3010 = 0 AND e.has_3020 = 0 THEN 0
         WHEN e.effective_type = 'inventory_restock' THEN -e.liquid_net
         WHEN e.effective_type = 'ap_settlement' AND e.payable_bill_category = 'inventory_restock' THEN -e.liquid_net
         ELSE 0
       END), 0.00) AS restock_cash_outflow,
       COALESCE(SUM(CASE
         WHEN e.effective_type <> 'opening_balance' AND e.has_1510 = 1 AND e.has_1050 = 0 AND e.has_3010 = 0 AND e.has_3020 = 0 THEN 0
         WHEN e.effective_type = 'income_tax' THEN -e.liquid_net
         WHEN e.effective_type = 'ap_settlement' AND (e.payable_bill_category = 'income_tax' OR (e.payable_bill_category IS NULL AND e.has_2030 = 1)) THEN -e.liquid_net
         WHEN e.effective_type NOT IN ('capital_injection', 'opening_balance', 'owner_withdrawal', 'sales_revenue', 'operating_expense', 'inventory_restock', 'ap_settlement')
          AND NOT (e.has_3010 = 1 AND e.has_1050 = 0 AND e.has_4010 = 0 AND e.has_5010 = 0)
          AND NOT (e.has_3020 = 1 AND e.has_1050 = 0 AND e.has_4010 = 0 AND e.has_5010 = 0)
          AND (e.has_2030 = 1 OR e.has_6310 = 1) AND e.has_4010 = 0 AND e.has_5010 = 0 THEN -e.liquid_net
         ELSE 0
       END), 0.00) AS tax_cash_outflow,
       COALESCE(SUM(CASE
         WHEN e.effective_type <> 'opening_balance' AND e.has_1510 = 1 AND e.has_1050 = 0 AND e.has_3010 = 0 AND e.has_3020 = 0 THEN 0
         WHEN e.effective_type IN ('capital_injection', 'opening_balance', 'owner_withdrawal', 'sales_revenue', 'operating_expense', 'inventory_restock', 'income_tax', 'ap_settlement') THEN 0
         WHEN e.has_3010 = 1 AND e.has_1050 = 0 AND e.has_4010 = 0 AND e.has_5010 = 0 THEN 0
         WHEN e.has_3020 = 1 AND e.has_1050 = 0 AND e.has_4010 = 0 AND e.has_5010 = 0 THEN 0
         WHEN (e.has_2030 = 1 OR e.has_6310 = 1) AND e.has_4010 = 0 AND e.has_5010 = 0 THEN 0
         ELSE e.liquid_net
       END), 0.00) AS other_operating_cash_net,
       COALESCE(SUM(CASE
         WHEN e.effective_type <> 'opening_balance' AND e.has_1510 = 1 AND e.has_1050 = 0 AND e.has_3010 = 0 AND e.has_3020 = 0 THEN e.liquid_net
         ELSE 0
       END), 0.00) AS investing_net,
       COALESCE(SUM(CASE
         WHEN e.effective_type <> 'opening_balance' AND e.has_1510 = 1 AND e.has_1050 = 0 AND e.has_3010 = 0 AND e.has_3020 = 0 THEN 0
         WHEN e.effective_type IN ('capital_injection', 'opening_balance') THEN e.liquid_net
         WHEN e.effective_type NOT IN ('owner_withdrawal', 'sales_revenue', 'operating_expense', 'inventory_restock', 'income_tax', 'ap_settlement')
          AND e.has_3010 = 1 AND e.has_1050 = 0 AND e.has_4010 = 0 AND e.has_5010 = 0 THEN e.liquid_net
         ELSE 0
       END), 0.00) AS capital_inflow,
       COALESCE(SUM(CASE
         WHEN e.effective_type <> 'opening_balance' AND e.has_1510 = 1 AND e.has_1050 = 0 AND e.has_3010 = 0 AND e.has_3020 = 0 THEN 0
         WHEN e.effective_type IN ('capital_injection', 'opening_balance') THEN 0
         WHEN e.effective_type = 'owner_withdrawal' THEN -e.liquid_net
         WHEN e.effective_type NOT IN ('sales_revenue', 'operating_expense', 'inventory_restock', 'income_tax', 'ap_settlement')
          AND NOT (e.has_3010 = 1 AND e.has_1050 = 0 AND e.has_4010 = 0 AND e.has_5010 = 0)
          AND e.has_3020 = 1 AND e.has_1050 = 0 AND e.has_4010 = 0 AND e.has_5010 = 0 THEN -e.liquid_net
         ELSE 0
       END), 0.00) AS drawing_outflow
     FROM (
       SELECT je.id AS entry_id,
              CASE
                WHEN je.entry_type = 'void_reversal' AND parent_je.entry_type IS NOT NULL THEN parent_je.entry_type
                ELSE je.entry_type
              END AS effective_type,
              fp.bill_category AS payable_bill_category,
              ROUND(SUM(CASE WHEN coa.account_code IN ('1010', '1020', '1030', '1040') THEN jel.debit - jel.credit ELSE 0 END), 2) AS liquid_net,
              MAX(CASE WHEN coa.account_code = '1510' THEN 1 ELSE 0 END) AS has_1510,
              MAX(CASE WHEN coa.account_code = '1050' THEN 1 ELSE 0 END) AS has_1050,
              MAX(CASE WHEN coa.account_code = '3010' THEN 1 ELSE 0 END) AS has_3010,
              MAX(CASE WHEN coa.account_code = '3020' THEN 1 ELSE 0 END) AS has_3020,
              MAX(CASE WHEN coa.account_code = '4010' THEN 1 ELSE 0 END) AS has_4010,
              MAX(CASE WHEN coa.account_code = '5010' THEN 1 ELSE 0 END) AS has_5010,
              MAX(CASE WHEN coa.account_code = '2030' THEN 1 ELSE 0 END) AS has_2030,
              MAX(CASE WHEN coa.account_code = '6310' THEN 1 ELSE 0 END) AS has_6310
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
         LEFT JOIN journal_entries parent_je ON parent_je.id = je.reverses_entry_id
         LEFT JOIN financial_payables fp ON fp.id = COALESCE(je.payable_id, parent_je.payable_id)
         ${whereClause}
        GROUP BY je.id, effective_type, fp.bill_category
       HAVING ABS(liquid_net) >= 0.005
     ) e`,
    params,
  );

  const cashSalesInflow = round2(aggRow?.cash_sales_inflow || 0);
  const opexCashOutflow = round2(aggRow?.opex_cash_outflow || 0);
  const restockCashOutflow = round2(aggRow?.restock_cash_outflow || 0);
  const taxCashOutflow = round2(aggRow?.tax_cash_outflow || 0);
  const otherOperatingCashNet = round2(aggRow?.other_operating_cash_net || 0);
  const investingNet = round2(aggRow?.investing_net || 0);
  const capitalInflow = round2(aggRow?.capital_inflow || 0);
  const drawingOutflow = round2(aggRow?.drawing_outflow || 0);

  const operatingCashFlow = round2(
    cashSalesInflow + otherOperatingCashNet - (opexCashOutflow + restockCashOutflow + taxCashOutflow),
  );
  const equipmentPurchased = round2(-investingNet);
  const investingCashFlow = round2(investingNet);
  const financingCashFlow = round2(capitalInflow - drawingOutflow);
  const netCashFlow = round2(operatingCashFlow + investingCashFlow + financingCashFlow);

  return {
    operatingActivities: {
      cashSalesInflow: round2(cashSalesInflow),
      otherOperatingCashNet: round2(otherOperatingCashNet),
      opexCashOutflow: round2(opexCashOutflow),
      restockCashOutflow: round2(restockCashOutflow),
      taxCashOutflow: round2(taxCashOutflow),
      netOperatingCashFlow: operatingCashFlow,
    },
    investingActivities: {
      equipmentPurchased,
      netInvestingCashFlow: investingCashFlow,
    },
    financingActivities: {
      capitalInjected: round2(capitalInflow),
      drawingsWithdrawn: round2(drawingOutflow),
      netFinancingCashFlow: financingCashFlow,
    },
    netCashFlow,
  };
}

export async function getDailyReconciliationReport({ from: rawFrom, to: rawTo, page, limit } = {}) {
  const { from, to } = assertValidDateRange(rawFrom, rawTo);
  const numPage = parseBoundedPositiveInt(page, 1, 1, 100_000, "Page");
  const numLimit = parseBoundedPositiveInt(limit, 25, 1, 100, "Limit");
  const offset = (numPage - 1) * numLimit;

  const conditions = [];
  const params = [];

  if (from) {
    conditions.push("snap.business_date >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("snap.business_date <= ?");
    params.push(to);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM store_daily_asset_snapshots snap ${whereClause}`,
    params,
  );

  const [rows] = await pool.query(
    `SELECT snap.*,
            DATE_FORMAT(snap.business_date, '%Y-%m-%d') AS business_date_formatted,
            COALESCE(u1.display_name, u1.username) AS opened_by_name,
            COALESCE(u2.display_name, u2.username) AS closed_by_name
       FROM store_daily_asset_snapshots snap
       LEFT JOIN users u1 ON u1.id = snap.opened_by
       LEFT JOIN users u2 ON u2.id = snap.closed_by
       ${whereClause}
      ORDER BY snap.business_date DESC
      LIMIT ? OFFSET ?`,
    [...params, numLimit, offset],
  );

  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      businessDate: r.business_date_formatted || formatDbDateOnly(r.business_date),
      status: r.status,
      openingLiquidAssets: round2(r.opening_liquid_assets),
      openingInventoryValue: round2(r.opening_inventory_value),
      openingNonCurrentAssets: round2(r.opening_non_current_assets),
      openingTotalAssets: round2(r.opening_total_assets),
      closingLiquidAssets: r.closing_liquid_assets != null ? round2(r.closing_liquid_assets) : null,
      closingInventoryValue: r.closing_inventory_value != null ? round2(r.closing_inventory_value) : null,
      closingNonCurrentAssets: r.closing_non_current_assets != null ? round2(r.closing_non_current_assets) : null,
      closingTotalAssets: r.closing_total_assets != null ? round2(r.closing_total_assets) : null,
      grossSales: round2(r.gross_sales),
      discountsGranted: round2(r.discounts_granted),
      netSales: round2(r.net_sales),
      cogsConsumed: round2(r.cogs_consumed),
      grossProfit: round2(r.gross_profit),
      operatingExpenses: round2(r.operating_expenses),
      netOperatingProfit: round2(r.net_operating_profit),
      capitalInjections: round2(r.capital_injections),
      ownerWithdrawals: round2(r.owner_withdrawals),
      drawerVariance: round2(r.drawer_variance),
      spoilageShrinkage: round2(r.spoilage_shrinkage),
      netAssetDelta: r.net_asset_delta != null ? round2(r.net_asset_delta) : null,
      openedByName: r.opened_by_name,
      closedByName: r.closed_by_name,
    })),
    total: Number(countRow?.total || 0),
    page: numPage,
    limit: numLimit,
  };
}

export async function getBalanceSheetReport() {
  const [accounts] = await pool.query(ACTIVE_COA_VIEW_SQL);
  const [[invRow]] = await pool.query(
    "SELECT COALESCE(SUM(quantity * unit_cost), 0.00) AS live_inventory_value FROM inventory_items WHERE is_archived = FALSE",
  );
  const liveInventoryValue = round2(invRow?.live_inventory_value);

  const bs = summarizeBalanceSheetAccounts(accounts);
  const ledgerInventoryValue = bs.accountMap.get("1050") || 0.00;
  const inventoryValuationVariance = round2(liveInventoryValue - ledgerInventoryValue);

  const retainedEarnings = summarizeIncomeStatementLines(accounts, { clampSections: false }).netIncome;
  const totalEquity = round2(bs.ownerCapital - bs.ownerDrawings + retainedEarnings);
  const balanceDifference = round2(bs.totalAssets - (bs.totalLiabilities + totalEquity));
  const isBalanced = Math.abs(balanceDifference) < 0.005;

  return {
    asOfDate: getManilaDateString(),
    assets: {
      current: bs.currentAssets,
      nonCurrent: bs.nonCurrentAssets,
      grossEquipment: bs.grossEquipment,
      accumulatedDepreciation: bs.accumulatedDepreciation,
      netEquipment: bs.netEquipment,
      totalAssets: bs.totalAssets,
    },
    grossEquipment: bs.grossEquipment,
    accumulatedDepreciation: bs.accumulatedDepreciation,
    netEquipment: bs.netEquipment,
    totalAssets: bs.totalAssets,
    ledgerInventoryValue,
    liveInventoryValue,
    inventoryValuationVariance,
    liabilities: {
      current: bs.currentLiabilities,
      totalLiabilities: bs.totalLiabilities,
    },
    totalLiabilities: bs.totalLiabilities,
    equity: {
      capital: bs.ownerCapital,
      ownerCapital: bs.ownerCapital,
      drawings: bs.ownerDrawings,
      ownerDrawings: bs.ownerDrawings,
      retainedEarnings,
      totalEquity,
    },
    totalEquity,
    balanceDifference,
    isBalanced,
  };
}
