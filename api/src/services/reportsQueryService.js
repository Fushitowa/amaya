import pool from "../database.js";
import { httpError } from "../middleware/auth.js";
import { escapeLikePattern } from "../utils/validation.js";
import { round2 } from "../../../shared/units.js";
import { getManilaTodayDateStr, isValidIsoDateOnly } from "../../../shared/manilaDate.js";
import {
  buildRestockSummary,
  computeRestockItemPlan,
  convertConsumptionToStockUnit,
  serializeRestockPlanItem,
  sortRestockSuggestions,
} from "../../../shared/restockSuggestion.js";

export const VALID_RANGE_KEYS = new Set(["today", "7d", "30d", "all", "custom"]);
export const VALID_PAYMENT_METHODS = new Set(["Cash", "GCash", "Card"]);
export const VALID_ORDER_TYPES = new Set(["Counter", "Takeout", "Dine-in"]);
export const VALID_ORDER_STATUSES = new Set(["Pending", "Preparing", "Completed", "Cancelled"]);
export const VALID_MOVEMENT_TYPES = new Set(["restock", "adjustment", "usage", "spoilage", "void_restore", "internal_use"]);
export const VALID_EXPORT_TYPES = new Set(["orders", "staff", "products", "inventory"]);

export function groupRowsByKey(rows, keyField) {
  const grouped = new Map();
  for (const row of rows) {
    const key = Number(row[keyField]);
    let list = grouped.get(key);
    if (!list) {
      list = [];
      grouped.set(key, list);
    }
    list.push(row);
  }
  return grouped;
}

export function addDaysIsoDate(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = String(dt.getUTCFullYear()).padStart(4, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function diffDaysInclusive(fromDate, toDate) {
  const [y1, m1, d1] = fromDate.split("-").map(Number);
  const [y2, m2, d2] = toDate.split("-").map(Number);
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.round(ms / 86_400_000) + 1;
}

export function formatDayLabel(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function resolveRange(query = {}) {
  const rawRangeKey = query.rangeKey !== undefined && query.rangeKey !== ""
    ? String(query.rangeKey).trim().toLowerCase()
    : null;
  const rawFrom = query.from !== undefined && query.from !== "" ? String(query.from).trim() : null;
  const rawTo = query.to !== undefined && query.to !== "" ? String(query.to).trim() : null;

  if (rawRangeKey && !VALID_RANGE_KEYS.has(rawRangeKey)) {
    throw httpError(400, "Invalid rangeKey. Expected today, 7d, 30d, all, or custom.");
  }
  if (rawFrom && !isValidIsoDateOnly(rawFrom)) {
    throw httpError(400, "Invalid 'from' date. Expected YYYY-MM-DD.");
  }
  if (rawTo && !isValidIsoDateOnly(rawTo)) {
    throw httpError(400, "Invalid 'to' date. Expected YYYY-MM-DD.");
  }

  const today = getManilaTodayDateStr();
  let rangeKey = rawRangeKey;
  let from;
  let to;

  if (rangeKey === "all") {
    return {
      rangeKey: "all",
      from: null,
      to: null,
      start: null,
      end: null,
      previous: null,
    };
  }

  if (rangeKey === "custom" || (!rangeKey && (rawFrom || rawTo))) {
    rangeKey = "custom";
    if (!rawFrom && !rawTo) {
      throw httpError(400, "Custom range requires 'from' and 'to' dates (YYYY-MM-DD).");
    }
    to = rawTo || today;
    from = rawFrom || addDaysIsoDate(to, -29);
  } else {
    rangeKey = rangeKey || "30d";
    if (rangeKey === "today") {
      from = today;
      to = today;
    } else if (rangeKey === "7d") {
      to = today;
      from = addDaysIsoDate(today, -6);
    } else {
      to = today;
      from = addDaysIsoDate(today, -29);
    }
  }

  if (from > to) {
    throw httpError(400, "Start date (from) must be on or before end date (to).");
  }

  const spanDays = diffDaysInclusive(from, to);
  const prevTo = addDaysIsoDate(from, -1);
  const prevFrom = addDaysIsoDate(prevTo, -(spanDays - 1));

  return {
    rangeKey,
    from,
    to,
    start: `${from} 00:00:00`,
    end: `${to} 23:59:59`,
    previous: {
      from: prevFrom,
      to: prevTo,
      start: `${prevFrom} 00:00:00`,
      end: `${prevTo} 23:59:59`,
    },
  };
}

export function parseOrderFilters(query = {}) {
  const rawStaffId = query.staffId !== undefined && query.staffId !== ""
    ? query.staffId
    : query.cashierId;
  let staffId = null;
  if (rawStaffId !== undefined && rawStaffId !== "") {
    const parsed = Number(rawStaffId);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw httpError(400, "Invalid staffId filter.");
    }
    staffId = parsed;
  }

  let paymentMethod = null;
  if (query.paymentMethod !== undefined && query.paymentMethod !== "") {
    const candidate = String(query.paymentMethod).trim();
    if (!VALID_PAYMENT_METHODS.has(candidate)) {
      throw httpError(400, "Invalid paymentMethod filter. Expected Cash, GCash, or Card.");
    }
    paymentMethod = candidate;
  }

  let orderType = null;
  if (query.orderType !== undefined && query.orderType !== "") {
    const candidate = String(query.orderType).trim();
    if (!VALID_ORDER_TYPES.has(candidate)) {
      throw httpError(400, "Invalid orderType filter. Expected Counter, Takeout, or Dine-in.");
    }
    orderType = candidate;
  }

  let status = null;
  if (query.status !== undefined && query.status !== "") {
    const candidate = String(query.status).trim();
    if (!VALID_ORDER_STATUSES.has(candidate)) {
      throw httpError(400, "Invalid status filter.");
    }
    status = candidate;
  }

  const search = query.search !== undefined && String(query.search).trim() !== ""
    ? String(query.search).trim().slice(0, 120)
    : null;

  return { staffId, paymentMethod, orderType, status, search };
}

export function buildOrderWhereClause({ start = null, end = null, filters = {}, alias = "o" } = {}) {
  const conditions = [];
  const params = [];

  if (start && end) {
    conditions.push(`${alias}.created_at BETWEEN ? AND ?`);
    params.push(start, end);
  }
  if (filters.staffId) {
    conditions.push(`COALESCE(${alias}.paid_by, ${alias}.created_by) = ?`);
    params.push(filters.staffId);
  }
  if (filters.paymentMethod) {
    conditions.push(`${alias}.payment_method = ?`);
    params.push(filters.paymentMethod);
  }
  if (filters.orderType) {
    conditions.push(`${alias}.order_type = ?`);
    params.push(filters.orderType);
  }
  if (filters.status) {
    conditions.push(`${alias}.order_status = ?`);
    params.push(filters.status);
  }
  if (filters.search) {
    const term = `%${escapeLikePattern(filters.search.toLowerCase())}%`;
    conditions.push(
      `(LOWER(${alias}.order_number) LIKE ?
        OR LOWER(${alias}.customer_name) LIKE ?
        OR LOWER(COALESCE(${alias}.cashier_name, '')) LIKE ?
        OR EXISTS (
          SELECT 1 FROM order_items oi_s
           WHERE oi_s.order_id = ${alias}.id
             AND LOWER(oi_s.product_name_snapshot) LIKE ?
        ))`,
    );
    params.push(term, term, term, term);
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export const LINE_COGS_EXPR = `
  COALESCE(
    NULLIF(oic_sum.consumption_cost, 0),
    oi.quantity * COALESCE(NULLIF(oi.unit_cost_snapshot, 0), NULLIF(mp.cost_price, 0), 0)
  )
`;

export const UNCOSTED_CASE_EXPR = `
  COALESCE(oic_sum.uncosted_ingredient_count, 0) > 0
  OR (
    COALESCE(oic_sum.consumption_cost, 0) <= 0
    AND COALESCE(oi.unit_cost_snapshot, 0) <= 0
    AND COALESCE(mp.cost_price, 0) <= 0
  )
`;

export async function queryPeriodFinancialMetrics(bounds, filters) {
  const { whereSql, params } = buildOrderWhereClause({
    start: bounds?.start || null,
    end: bounds?.end || null,
    filters,
    alias: "o",
  });

  const [[orderAgg]] = await pool.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN o.total ELSE 0 END), 0) AS gross_collected_sales,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN (o.total + COALESCE(o.discount_amount, 0) - COALESCE(o.tax_amount, 0)) ELSE 0 END), 0) AS gross_sales,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN COALESCE(o.discount_amount, 0) ELSE 0 END), 0) AS discount_total,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN COALESCE(o.tax_amount, 0) ELSE 0 END), 0) AS tax_collected,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN 1 ELSE 0 END), 0) AS paid_orders_count,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Unpaid' AND o.order_status <> 'Cancelled' THEN 1 ELSE 0 END), 0) AS unpaid_orders_count,
       COALESCE(SUM(CASE WHEN o.order_status = 'Cancelled' THEN 1 ELSE 0 END), 0) AS voided_orders_count,
       COALESCE(SUM(CASE WHEN o.order_status = 'Cancelled' THEN o.total ELSE 0 END), 0) AS voided_sales_total,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND COALESCE(o.payment_method, 'Cash') = 'Cash' THEN o.total ELSE 0 END), 0) AS cash_collected,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'GCash' THEN o.total ELSE 0 END), 0) AS gcash_collected,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'Card' THEN o.total ELSE 0 END), 0) AS card_collected,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.owner_confirmed_at IS NULL THEN 1 ELSE 0 END), 0) AS unconfirmed_orders_count,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.owner_confirmed_at IS NULL THEN o.total ELSE 0 END), 0) AS unconfirmed_sales,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND COALESCE(o.payment_method, 'Cash') = 'Cash' AND o.owner_confirmed_at IS NULL THEN o.total ELSE 0 END), 0) AS unconfirmed_cash_sales,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.owner_confirmed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS confirmed_orders_count,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.owner_confirmed_at IS NOT NULL THEN o.total ELSE 0 END), 0) AS confirmed_sales,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND COALESCE(o.payment_method, 'Cash') = 'Cash' AND o.owner_confirmed_at IS NOT NULL THEN o.total ELSE 0 END), 0) AS confirmed_cash_sales,
       MAX(o.owner_confirmed_at) AS last_owner_confirmed_at
     FROM orders o
     ${whereSql}`,
    params,
  );

  const itemConditions = ["o.payment_status = 'Paid'", "o.order_status <> 'Cancelled'"];
  const itemParams = [];
  if (bounds?.start && bounds?.end) {
    itemConditions.push("o.created_at BETWEEN ? AND ?");
    itemParams.push(bounds.start, bounds.end);
  }
  if (filters.staffId) {
    itemConditions.push("COALESCE(o.paid_by, o.created_by) = ?");
    itemParams.push(filters.staffId);
  }
  if (filters.paymentMethod) {
    itemConditions.push("o.payment_method = ?");
    itemParams.push(filters.paymentMethod);
  }
  if (filters.orderType) {
    itemConditions.push("o.order_type = ?");
    itemParams.push(filters.orderType);
  }
  if (filters.status) {
    itemConditions.push("o.order_status = ?");
    itemParams.push(filters.status);
  }
  if (filters.search) {
    const term = `%${escapeLikePattern(filters.search.toLowerCase())}%`;
    itemConditions.push(
      `(LOWER(o.order_number) LIKE ?
        OR LOWER(o.customer_name) LIKE ?
        OR LOWER(COALESCE(o.cashier_name, '')) LIKE ?
        OR EXISTS (
          SELECT 1 FROM order_items oi_s
           WHERE oi_s.order_id = o.id
             AND LOWER(oi_s.product_name_snapshot) LIKE ?
        ))`,
    );
    itemParams.push(term, term, term, term);
  }

  const [[itemAgg]] = await pool.execute(
    `SELECT
       COALESCE(SUM(oi.quantity), 0) AS units_sold,
       COALESCE(SUM(${LINE_COGS_EXPR}), 0) AS cogs,
       COALESCE(SUM(CASE WHEN ${UNCOSTED_CASE_EXPR} THEN oi.quantity ELSE 0 END), 0) AS uncosted_units,
       COALESCE(SUM(CASE WHEN ${UNCOSTED_CASE_EXPR} THEN 1 ELSE 0 END), 0) AS uncosted_lines
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN menu_products mp ON mp.id = oi.product_id
     LEFT JOIN (
       SELECT order_item_id,
              SUM(line_cost) AS consumption_cost,
              SUM(CASE WHEN COALESCE(unit_cost_snapshot, 0) <= 0 THEN 1 ELSE 0 END) AS uncosted_ingredient_count
         FROM order_inventory_consumptions
        WHERE order_item_id IS NOT NULL AND reversed_at IS NULL
        GROUP BY order_item_id
     ) oic_sum ON oic_sum.order_item_id = oi.id
     WHERE ${itemConditions.join(" AND ")}`,
    itemParams,
  );

  // The ledger posts COGS once per order, rounded to 2 decimals (postOrderSaleAndCogs), so the
  // Income Statement is the sum of per-order rounded amounts. Round per order here too, otherwise
  // rounding once over the whole period can drift from the ledger by a centavo.
  const [[perOrderCogsAgg]] = await pool.execute(
    `SELECT COALESCE(SUM(order_cogs), 0) AS cogs
       FROM (
         SELECT o.id, ROUND(SUM(${LINE_COGS_EXPR}), 2) AS order_cogs
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           LEFT JOIN menu_products mp ON mp.id = oi.product_id
           LEFT JOIN (
             SELECT order_item_id, SUM(line_cost) AS consumption_cost
               FROM order_inventory_consumptions
              WHERE order_item_id IS NOT NULL AND reversed_at IS NULL
              GROUP BY order_item_id
           ) oic_sum ON oic_sum.order_item_id = oi.id
          WHERE ${itemConditions.join(" AND ")}
          GROUP BY o.id
       ) per_order`,
    itemParams,
  );

  const movConditions = ["m.movement_type = 'restock'"];
  const movParams = [];
  if (bounds?.start && bounds?.end) {
    movConditions.push("m.created_at BETWEEN ? AND ?");
    movParams.push(bounds.start, bounds.end);
  }
  if (filters.staffId) {
    movConditions.push("m.user_id = ?");
    movParams.push(filters.staffId);
  }

  const [[movAgg]] = await pool.execute(
    `SELECT COUNT(*) AS restock_count,
            COALESCE(SUM(COALESCE(m.batch_cost, 0)), 0) AS inventory_expenditure
       FROM inventory_movements m
      WHERE ${movConditions.join(" AND ")}`,
    movParams,
  );

  const hasOrderSliceFilter = Boolean(
    filters.paymentMethod || filters.orderType || filters.status || filters.search,
  );
  const spoilConditions = ["coa.account_code = '6030'"];
  const spoilParams = [];
  let spoilOrderJoin = "";
  if (bounds?.start && bounds?.end) {
    spoilConditions.push("je.entry_date BETWEEN ? AND ?");
    spoilParams.push(bounds.start, bounds.end);
  }
  if (hasOrderSliceFilter) {
    spoilOrderJoin = "JOIN orders o ON o.id = je.order_id";
    const orderSliceWhere = buildOrderWhereClause({ filters, alias: "o" });
    if (orderSliceWhere.whereSql) {
      spoilConditions.push(orderSliceWhere.whereSql.replace(/^WHERE\s+/i, ""));
      spoilParams.push(...orderSliceWhere.params);
    }
  } else if (filters.staffId) {
    spoilOrderJoin = "LEFT JOIN orders o ON o.id = je.order_id";
    spoilConditions.push("COALESCE(o.paid_by, o.created_by, je.created_by) = ?");
    spoilParams.push(filters.staffId);
  }
  const [[spoilAgg]] = await pool.execute(
    `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS spoilage_cost
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       ${spoilOrderJoin}
      WHERE ${spoilConditions.join(" AND ")}`,
    spoilParams,
  );

  const grossCollectedSales = round2(orderAgg?.gross_collected_sales);
  const grossSales = round2(orderAgg?.gross_sales);
  const discountTotal = round2(orderAgg?.discount_total);
  const taxCollected = round2(orderAgg?.tax_collected);
  const netSales = round2(grossSales - discountTotal);
  const salesCogs = round2(perOrderCogsAgg?.cogs);
  const spoilageCost = round2(Math.max(0, spoilAgg?.spoilage_cost));
  const totalCogs = round2(salesCogs + spoilageCost);
  const grossProfit = round2(netSales - totalCogs);
  const reconciledGrossProfit = grossProfit;
  const paidOrdersCount = Number(orderAgg?.paid_orders_count || 0);

  return {
    grossCollectedSales,
    grossSales,
    discountTotal,
    taxCollected,
    netSales,
    cogs: totalCogs,
    salesCogs,
    spoilageCost,
    wasteCost: spoilageCost,
    totalCogs,
    grossProfit,
    reconciledGrossProfit,
    marginPercent: netSales > 0 ? round2((grossProfit / netSales) * 100) : 0,
    paidOrdersCount,
    unpaidOrdersCount: Number(orderAgg?.unpaid_orders_count || 0),
    voidedOrdersCount: Number(orderAgg?.voided_orders_count || 0),
    voidedSalesTotal: round2(orderAgg?.voided_sales_total),
    unitsSold: Number(itemAgg?.units_sold || 0),
    averageOrderValue: paidOrdersCount > 0 ? round2(grossCollectedSales / paidOrdersCount) : 0,
    cashCollected: round2(orderAgg?.cash_collected),
    gcashCollected: round2(orderAgg?.gcash_collected),
    cardCollected: round2(orderAgg?.card_collected),
    unconfirmedOrdersCount: Number(orderAgg?.unconfirmed_orders_count || 0),
    unconfirmedSales: round2(orderAgg?.unconfirmed_sales),
    unconfirmedCashSales: round2(orderAgg?.unconfirmed_cash_sales),
    confirmedOrdersCount: Number(orderAgg?.confirmed_orders_count || 0),
    confirmedSales: round2(orderAgg?.confirmed_sales),
    confirmedCashSales: round2(orderAgg?.confirmed_cash_sales),
    lastOwnerConfirmedAt: orderAgg?.last_owner_confirmed_at ? new Date(orderAgg.last_owner_confirmed_at).toISOString() : null,
    uncostedItemsCount: Number(itemAgg?.uncosted_units || 0),
    uncostedLineCount: Number(itemAgg?.uncosted_lines || 0),
    inventoryExpenditure: round2(movAgg?.inventory_expenditure),
    inventoryRestockCount: Number(movAgg?.restock_count || 0),
  };
}

export function buildDeltaMetric(current, previous) {
  const diff = round2(current - previous);
  const percent = previous > 0
    ? round2(((current - previous) / previous) * 100)
    : (current === 0 ? 0 : null);
  return { change: diff, percent };
}

export function sanitizeCsvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  let str = String(value);
  let start = 0;
  while (start < str.length && (str.charCodeAt(start) <= 32 || /\s/.test(str[start]))) {
    start += 1;
  }
  const trimmed = str.slice(start);
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvDocument(headers, rows) {
  const lines = [
    headers.map(sanitizeCsvCell).join(","),
    ...rows.map((row) => row.map(sanitizeCsvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function queryHourlySalesData(query = {}) {
  const range = resolveRange(query);
  const filters = parseOrderFilters(query);
  const { whereSql, params } = buildOrderWhereClause({
    start: range.start,
    end: range.end,
    filters,
    alias: "o",
  });
  const paidCondition = whereSql
    ? `${whereSql} AND o.payment_status = 'Paid' AND o.order_status <> 'Cancelled'`
    : "WHERE o.payment_status = 'Paid' AND o.order_status <> 'Cancelled'";

  const [rows] = await pool.execute(
    `SELECT HOUR(o.created_at) AS hour_of_day,
            COUNT(*) AS orders_count,
            COALESCE(SUM(o.total), 0) AS sales
       FROM orders o
       ${paidCondition}
      GROUP BY HOUR(o.created_at)
      ORDER BY hour_of_day ASC`,
    params,
  );

  const hours = rows.map((row) => ({
    hour: Number(row.hour_of_day),
    ordersCount: Number(row.orders_count || 0),
    sales: round2(row.sales),
  }));
  let peakHour = null;
  let totalOrders = 0;
  let totalSales = 0;
  for (const h of hours) {
    totalOrders += h.ordersCount;
    totalSales = round2(totalSales + h.sales);
    if (!peakHour || h.sales > peakHour.sales || (h.sales === peakHour.sales && h.ordersCount > peakHour.ordersCount)) {
      peakHour = h;
    }
  }

  return {
    range: {
      rangeKey: range.rangeKey,
      from: range.from,
      to: range.to,
    },
    hours,
    peakHour,
    totalOrders,
    totalSales,
  };
}

export async function queryProductReportData(range, query = {}, { paginate = false } = {}) {
  const filters = parseOrderFilters(query);
  const category = query.category !== undefined && String(query.category).trim() !== ""
    ? String(query.category).trim().slice(0, 100)
    : null;

  const conditions = ["o.payment_status = 'Paid'", "o.order_status <> 'Cancelled'"];
  const params = [];

  if (range.start && range.end) {
    conditions.push("o.created_at BETWEEN ? AND ?");
    params.push(range.start, range.end);
  }
  if (filters.staffId) {
    conditions.push("COALESCE(o.paid_by, o.created_by) = ?");
    params.push(filters.staffId);
  }
  if (filters.paymentMethod) {
    conditions.push("o.payment_method = ?");
    params.push(filters.paymentMethod);
  }
  if (filters.orderType) {
    conditions.push("o.order_type = ?");
    params.push(filters.orderType);
  }
  if (category) {
    conditions.push("COALESCE(oi.category_name_snapshot, 'Menu item') = ?");
    params.push(category);
  }
  if (filters.search) {
    const term = `%${escapeLikePattern(filters.search.toLowerCase())}%`;
    conditions.push("(LOWER(oi.product_name_snapshot) LIKE ? OR LOWER(COALESCE(oi.category_name_snapshot, '')) LIKE ?)");
    params.push(term, term);
  }

  const groupedSql = `
    SELECT oi.product_id,
           oi.product_name_snapshot,
           COALESCE(oi.size_label, 'Regular') AS size_label,
           COALESCE(oi.category_name_snapshot, 'Menu item') AS category_name,
           COUNT(DISTINCT oi.order_id) AS orders_count,
           COALESCE(SUM(oi.quantity), 0) AS units_sold,
           COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS sales,
           COALESCE(SUM(oi.quantity * COALESCE(oia_sum.addons_unit_total, 0)), 0) AS addon_sales,
           COALESCE(SUM(${LINE_COGS_EXPR}), 0) AS cogs,
           COALESCE(SUM(COALESCE(oic_sum.recipe_cost, 0)), 0) AS recipe_cogs,
           COALESCE(SUM(COALESCE(oic_sum.addon_cost, 0)), 0) AS addon_cogs,
           COALESCE(SUM(CASE WHEN ${UNCOSTED_CASE_EXPR} THEN oi.quantity ELSE 0 END), 0) AS uncosted_units
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN menu_products mp ON mp.id = oi.product_id
      LEFT JOIN (
        SELECT order_item_id,
               SUM(line_cost) AS consumption_cost,
               SUM(CASE WHEN source = 'recipe' THEN line_cost ELSE 0 END) AS recipe_cost,
               SUM(CASE WHEN source = 'addon' THEN line_cost ELSE 0 END) AS addon_cost,
               SUM(CASE WHEN COALESCE(unit_cost_snapshot, 0) <= 0 THEN 1 ELSE 0 END) AS uncosted_ingredient_count
          FROM order_inventory_consumptions
         WHERE order_item_id IS NOT NULL AND reversed_at IS NULL
         GROUP BY order_item_id
      ) oic_sum ON oic_sum.order_item_id = oi.id
      LEFT JOIN (
        SELECT order_item_id, SUM(addon_price_snapshot) AS addons_unit_total
          FROM order_item_addons
         GROUP BY order_item_id
      ) oia_sum ON oia_sum.order_item_id = oi.id
     WHERE ${conditions.join(" AND ")}
     GROUP BY oi.product_id, oi.product_name_snapshot, COALESCE(oi.size_label, 'Regular'), COALESCE(oi.category_name_snapshot, 'Menu item')
  `;

  const sortBy = String(query.sortBy || "sales").trim();
  const sortDirSql = String(query.sortDir || "desc").trim().toLowerCase() === "asc" ? "ASC" : "DESC";
  const sortExprMap = {
    productName: "g.product_name_snapshot",
    sales: "ROUND(g.sales, 2)",
    unitsSold: "g.units_sold",
    grossProfit: "ROUND(ROUND(g.sales, 2) - ROUND(g.cogs, 2), 2)",
    cogs: "ROUND(g.cogs, 2)",
    marginPercent: "CASE WHEN g.sales > 0 THEN ROUND(((g.sales - g.cogs) / g.sales) * 100, 2) ELSE 0 END",
  };
  const orderExpr = sortExprMap[sortBy] || "ROUND(g.sales, 2)";
  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(query?.limit, 10) || 100));
  const offset = (page - 1) * limit;

  const [[aggRow], [rows]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total_rows,
              COALESCE(SUM(g.units_sold), 0) AS total_units_sold,
              COALESCE(SUM(ROUND(g.sales, 2)), 0) AS total_sales,
              COALESCE(SUM(ROUND(g.addon_sales, 2)), 0) AS total_addon_sales,
              COALESCE(SUM(ROUND(g.cogs, 2)), 0) AS total_cogs,
              COALESCE(SUM(g.uncosted_units), 0) AS total_uncosted_units
         FROM (${groupedSql}) g`,
      params,
    ),
    pool.query(
      `SELECT g.*
         FROM (${groupedSql}) g
        ORDER BY ${orderExpr} ${sortDirSql}, g.units_sold DESC, g.product_name_snapshot ASC
        ${paginate ? "LIMIT ? OFFSET ?" : ""}`,
      paginate ? [...params, limit, offset] : params,
    ),
  ]);

  const mapped = rows.map((row) => {
    const sales = round2(row.sales);
    const addonSales = round2(row.addon_sales);
    const baseSales = round2(sales - addonSales);
    const cogs = round2(row.cogs);
    const grossProfit = round2(sales - cogs);
    return {
      productId: row.product_id == null ? null : Number(row.product_id),
      productName: row.product_name_snapshot,
      sizeLabel: row.size_label || "Regular",
      category: row.category_name || "Menu item",
      ordersCount: Number(row.orders_count || 0),
      unitsSold: Number(row.units_sold || 0),
      sales,
      baseSales,
      addonSales,
      cogs,
      recipeCogs: round2(row.recipe_cogs),
      addonCogs: round2(row.addon_cogs),
      grossProfit,
      marginPercent: sales > 0 ? round2((grossProfit / sales) * 100) : 0,
      uncostedItemsCount: Number(row.uncosted_units || 0),
    };
  });

  const totalSales = round2(aggRow?.total_sales);
  const totalAddonSales = round2(aggRow?.total_addon_sales);
  const totalCogs = round2(aggRow?.total_cogs);
  const totals = {
    unitsSold: Number(aggRow?.total_units_sold || 0),
    sales: totalSales,
    baseSales: round2(totalSales - totalAddonSales),
    addonSales: totalAddonSales,
    cogs: totalCogs,
    grossProfit: round2(totalSales - totalCogs),
    uncostedItemsCount: Number(aggRow?.total_uncosted_units || 0),
  };

  return {
    items: mapped,
    totals,
    total: Number(aggRow?.total_rows || 0),
    page,
    limit,
  };
}

export async function queryOrdersReportData(range, query = {}, { paginate = true, maxRows = 5000, includeItems = true } = {}) {
  const filters = parseOrderFilters(query);
  const { whereSql, params } = buildOrderWhereClause({
    start: range.start,
    end: range.end,
    filters,
    alias: "o",
  });

  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(query?.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const [totalsSummary, [countRows]] = await Promise.all([
    queryPeriodFinancialMetrics(range.from ? range : null, filters),
    pool.query(`SELECT COUNT(*) AS total FROM orders o ${whereSql}`, params),
  ]);

  const orderSql = `
    SELECT o.*,
           NULLIF(u.display_name, '') AS creator_display_name,
           COALESCE(NULLIF(uc.display_name, ''), uc.username) AS confirmed_by_name,
           COALESCE(NULLIF(up.display_name, ''), up.username) AS paid_by_name,
           COALESCE(NULLIF(uoc.display_name, ''), uoc.username) AS owner_confirmed_by_name,
           COALESCE(NULLIF(uco.display_name, ''), uco.username) AS completed_by_name,
           COALESCE(NULLIF(uv.display_name, ''), uv.username) AS voided_by_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.created_by
      LEFT JOIN users uc ON uc.id = o.confirmed_by
      LEFT JOIN users up ON up.id = o.paid_by
      LEFT JOIN users uoc ON uoc.id = o.owner_confirmed_by
      LEFT JOIN users uco ON uco.id = o.completed_by
      LEFT JOIN users uv ON uv.id = o.voided_by
      ${whereSql}
     ORDER BY o.created_at DESC, o.id DESC
     ${paginate ? "LIMIT ? OFFSET ?" : "LIMIT ?"}
  `;
  const safeMaxRows = Math.min(25000, Math.max(100, Number(maxRows) || 5000));
  const orderParams = paginate ? [...params, limit, offset] : [...params, safeMaxRows];
  const [orderRows] = await pool.query(orderSql, orderParams);

  let orderItems = [];
  let orderAddons = [];
  if (includeItems && orderRows.length > 0) {
    const orderIds = orderRows.map((o) => o.id);
    const marks = orderIds.map(() => "?").join(",");
    const [oiRes, oiaRes] = await Promise.all([
      pool.execute(
        `SELECT oi.*, p.name AS current_product_name
           FROM order_items oi
           LEFT JOIN menu_products p ON p.id = oi.product_id
          WHERE oi.order_id IN (${marks})
          ORDER BY oi.id`,
        orderIds,
      ),
      pool.execute(
        `SELECT oia.*, oi.order_id
           FROM order_item_addons oia
           JOIN order_items oi ON oi.id = oia.order_item_id
          WHERE oi.order_id IN (${marks})
          ORDER BY oia.id`,
        orderIds,
      ),
    ]);
    orderItems = oiRes[0];
    orderAddons = oiaRes[0];
  }

  const itemsByOrderId = includeItems ? groupRowsByKey(orderItems, "order_id") : new Map();
  const addonsByItemId = includeItems ? groupRowsByKey(orderAddons, "order_item_id") : new Map();

  const items = orderRows.map((order) => {
    const cashier = order.cashier_name || order.creator_display_name || "Staff";
    const orderItemRows = includeItems ? (itemsByOrderId.get(Number(order.id)) || []) : [];
    return {
      id: order.order_number,
      customer: order.customer_name,
      cashier,
      createdById: order.created_by == null ? null : Number(order.created_by),
      createdBy: cashier,
      confirmedBy: order.confirmed_by == null ? null : Number(order.confirmed_by),
      confirmedByName: order.confirmed_by_name || null,
      paidBy: order.paid_by == null ? null : Number(order.paid_by),
      paidByName: order.paid_by_name || null,
      completedBy: order.completed_by == null ? null : Number(order.completed_by),
      completedByName: order.completed_by_name || null,
      completedAt: order.completed_at ? new Date(order.completed_at).toISOString() : null,
      voidedBy: order.voided_by == null ? null : Number(order.voided_by),
      voidedByName: order.voided_by_name || null,
      voidedAt: order.voided_at ? new Date(order.voided_at).toISOString() : null,
      voidReason: order.void_reason || null,
      notes: order.notes || null,
      sessionId: order.session_id == null ? null : Number(order.session_id),
      total: Number(order.total),
      status: order.order_status,
      type: order.order_type,
      payment: order.payment_status,
      paymentMethod: order.payment_method,
      paidAt: order.paid_at ? new Date(order.paid_at).toISOString() : null,
      confirmed: Boolean(order.confirmed_at),
      confirmedAt: order.confirmed_at ? new Date(order.confirmed_at).toISOString() : null,
      ownerConfirmed: Boolean(order.owner_confirmed_at),
      ownerConfirmedAt: order.owner_confirmed_at ? new Date(order.owner_confirmed_at).toISOString() : null,
      ownerConfirmedBy: order.owner_confirmed_by == null ? null : Number(order.owner_confirmed_by),
      ownerConfirmedByName: order.owner_confirmed_by_name || null,
      ownerConfirmationNote: order.owner_confirmation_note || "",
      cashTendered: order.cash_tendered == null ? null : Number(order.cash_tendered),
      changeDue: order.change_due == null ? null : Number(order.change_due),
      cash_tendered: order.cash_tendered == null ? null : Number(order.cash_tendered),
      change_due: order.change_due == null ? null : Number(order.change_due),
      createdAt: new Date(order.created_at).toISOString(),
      items: orderItemRows.map((item) => ({
        id: Number(item.id),
        productId: item.product_id == null ? null : Number(item.product_id),
        title: item.product_name_snapshot || item.current_product_name,
        quantity: Number(item.quantity),
        price: Number(item.unit_price),
        unitCost: item.unit_cost_snapshot == null ? null : Number(item.unit_cost_snapshot),
        unitCostSnapshot: item.unit_cost_snapshot == null ? null : Number(item.unit_cost_snapshot),
        size: item.size_label,
        category: item.category_name_snapshot || "Menu item",
        sugarLevel: item.sugar_level,
        addons: (addonsByItemId.get(Number(item.id)) || []).map((addon) => addon.addon_name_snapshot),
        instructions: item.instructions,
      })),
    };
  });

  return {
    items,
    total: Number(countRows[0]?.total || 0),
    page,
    limit,
    totals: totalsSummary,
  };
}

export async function queryInventoryActivityData(range, query = {}, { paginate = true, maxRows = 5000 } = {}) {
  const rawUserId = query.userId !== undefined && query.userId !== "" ? query.userId : query.staffId;
  const rawType = query.movementType !== undefined && query.movementType !== "" ? query.movementType : query.type;
  const { itemId, search } = query;
  const conditions = [];
  const params = [];

  if (range.start && range.end) {
    conditions.push("m.created_at BETWEEN ? AND ?");
    params.push(range.start, range.end);
  }
  if (rawUserId !== undefined && rawUserId !== "") {
    const parsedUserId = Number(rawUserId);
    if (!Number.isSafeInteger(parsedUserId) || parsedUserId <= 0) {
      throw httpError(400, "Invalid userId filter.");
    }
    conditions.push("m.user_id = ?");
    params.push(parsedUserId);
  }
  if (itemId !== undefined && itemId !== "") {
    const parsedItemId = Number(itemId);
    if (!Number.isSafeInteger(parsedItemId) || parsedItemId <= 0) {
      throw httpError(400, "Invalid itemId filter.");
    }
    conditions.push("m.inventory_item_id = ?");
    params.push(parsedItemId);
  }
  if (rawType !== undefined && rawType !== "") {
    const cleanType = String(rawType).trim().toLowerCase();
    if (!VALID_MOVEMENT_TYPES.has(cleanType)) {
      throw httpError(400, "Invalid movement type filter.");
    }
    conditions.push("m.movement_type = ?");
    params.push(cleanType);
  }
  if (search !== undefined && String(search).trim() !== "") {
    const term = `%${escapeLikePattern(String(search).trim().toLowerCase())}%`;
    conditions.push(
      `(LOWER(COALESCE(ii.name, m.item_name_snapshot, '')) LIKE ?
        OR LOWER(COALESCE(m.note, '')) LIKE ?
        OR LOWER(COALESCE(m.supplier_name, '')) LIKE ?
        OR LOWER(COALESCE(m.reference_no, '')) LIKE ?)`,
    );
    params.push(term, term, term, term);
  }

  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(query?.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [[aggRow], [byTypeRows], [byActorRows], [rows]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total_movements,
              COALESCE(SUM(CASE WHEN m.movement_type = 'restock' THEN COALESCE(m.batch_cost, 0) ELSE 0 END), 0) AS total_restock_cost,
              COALESCE(SUM(CASE WHEN m.movement_type = 'restock' THEN 1 ELSE 0 END), 0) AS total_restock_count,
              COALESCE(SUM(CASE WHEN m.movement_type = 'adjustment' THEN 1 ELSE 0 END), 0) AS total_adjustment_count,
              COALESCE(SUM(CASE WHEN m.movement_type = 'usage' THEN 1 ELSE 0 END), 0) AS total_usage_count,
              COALESCE(SUM(CASE WHEN m.movement_type = 'spoilage' THEN 1 ELSE 0 END), 0) AS total_spoilage_count,
              COALESCE(SUM(CASE WHEN m.movement_type = 'void_restore' THEN 1 ELSE 0 END), 0) AS total_void_restore_count,
              COALESCE(SUM(CASE WHEN m.movement_type = 'internal_use' THEN 1 ELSE 0 END), 0) AS total_internal_use_count
         FROM inventory_movements m
         LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
        ${whereClause}`,
      params,
    ),
    pool.query(
      `SELECT m.movement_type,
              COUNT(*) AS count,
              COALESCE(SUM(COALESCE(m.batch_cost, 0)), 0) AS total_batch_cost
         FROM inventory_movements m
         LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
        ${whereClause}
        GROUP BY m.movement_type`,
      params,
    ),
    pool.query(
      `SELECT m.user_id,
              COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name,
              COUNT(*) AS actions_count,
              COALESCE(SUM(CASE WHEN m.movement_type = 'restock' THEN COALESCE(m.batch_cost, 0) ELSE 0 END), 0) AS restock_cost
         FROM inventory_movements m
         LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
         LEFT JOIN users u ON u.id = m.user_id
        ${whereClause}
        GROUP BY m.user_id, COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System')
        ORDER BY actions_count DESC`,
      params,
    ),
    pool.query(
      `SELECT m.*,
              COALESCE(ii.name, m.item_name_snapshot) AS item_name,
              ii.unit AS current_item_unit,
              COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name,
              o.order_number
         FROM inventory_movements m
         LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
         LEFT JOIN users u ON u.id = m.user_id
         LEFT JOIN orders o ON o.id = m.order_id
        ${whereClause}
        ORDER BY m.created_at DESC, m.id DESC
        ${paginate ? "LIMIT ? OFFSET ?" : "LIMIT ?"}`,
      paginate
        ? [...params, limit, offset]
        : [...params, Math.min(25000, Math.max(100, Number(maxRows) || 5000))],
    ),
  ]);

  const summaryHeader = aggRow[0] || {};
  return {
    summary: {
      totalMovements: Number(summaryHeader.total_movements || 0),
      totalRestockCost: round2(summaryHeader.total_restock_cost),
      totalRestockCount: Number(summaryHeader.total_restock_count || 0),
      totalAdjustmentCount: Number(summaryHeader.total_adjustment_count || 0),
      totalUsageCount: Number(summaryHeader.total_usage_count || 0),
      totalSpoilageCount: Number(summaryHeader.total_spoilage_count || 0),
      totalVoidRestoreCount: Number(summaryHeader.total_void_restore_count || 0),
      totalInternalUseCount: Number(summaryHeader.total_internal_use_count || 0),
      byType: byTypeRows.map((row) => ({
        type: row.movement_type,
        count: Number(row.count || 0),
        totalBatchCost: round2(row.total_batch_cost),
      })),
      byActor: byActorRows.map((row) => ({
        userId: row.user_id == null ? null : Number(row.user_id),
        actorName: row.actor_name || "System",
        actionsCount: Number(row.actions_count || 0),
        restockCost: round2(row.restock_cost),
      })),
    },
    items: rows.map((row) => ({
      id: Number(row.id),
      itemId: Number(row.inventory_item_id),
      itemName: row.item_name || row.item_name_snapshot || "Unknown Item",
      type: row.movement_type,
      quantityChange: Number(row.quantity_change),
      beforeQuantity: row.before_quantity == null ? null : Number(row.before_quantity),
      afterQuantity: row.after_quantity == null ? null : Number(row.after_quantity),
      unit: row.unit || row.current_item_unit || null,
      batchCost: row.batch_cost == null ? null : Number(row.batch_cost),
      unitCostBefore: row.unit_cost_before == null ? null : Number(row.unit_cost_before),
      unitCostAfter: row.unit_cost_after == null ? null : Number(row.unit_cost_after),
      supplierName: row.supplier_name || null,
      referenceNo: row.reference_no || null,
      orderId: row.order_id == null ? null : Number(row.order_id),
      orderNumber: row.order_number || null,
      sessionId: row.session_id == null ? null : Number(row.session_id),
      note: row.note || "",
      actorId: row.user_id == null ? null : Number(row.user_id),
      actor: row.actor_name || "System",
      timestamp: new Date(row.created_at).toISOString(),
    })),
    total: Number(summaryHeader.total_movements || 0),
    page,
    limit,
  };
}

export async function queryRestockSuggestions({
  lookbackDays = 14,
  coverDays = 7,
  todayDateStr = null,
} = {}) {
  const cleanLookback = Math.max(1, Math.min(90, Math.trunc(Number(lookbackDays) || 14)));
  const cleanCover = Math.max(1, Math.min(60, Math.trunc(Number(coverDays) || 7)));
  const today = todayDateStr || getManilaTodayDateStr();
  const fromDate = addDaysIsoDate(today, -(cleanLookback - 1));
  const windowStart = `${fromDate} 00:00:00`;
  const windowEnd = `${today} 23:59:59`;

  const [[inventoryRows], [settingsRows], [unitUsageRows], [usageMetaRows]] = await Promise.all([
    pool.execute(
      `SELECT id, name, category, quantity, unit, maximum_stock,
              unit_cost, purchase_price, package_quantity, contents_per_package, package_unit,
              created_at
         FROM inventory_items
        WHERE is_archived = FALSE`,
    ),
    pool.execute(
      `SELECT low_stock_threshold_pct, critical_stock_threshold_pct
         FROM business_settings
        WHERE id = 1
        LIMIT 1`,
    ),
    pool.execute(
      `SELECT oic.inventory_item_id,
              oic.unit,
              COALESCE(SUM(oic.quantity_used), 0) AS qty_used
         FROM order_inventory_consumptions oic
         JOIN orders o ON o.id = oic.order_id
        WHERE oic.reversed_at IS NULL
          AND o.order_status <> 'Cancelled'
          AND o.created_at >= ?
          AND o.created_at <= ?
        GROUP BY oic.inventory_item_id, oic.unit`,
      [windowStart, windowEnd],
    ),
    pool.execute(
      `SELECT oic.inventory_item_id,
              COUNT(DISTINCT oic.order_id) AS orders_using_count,
              COUNT(DISTINCT DATE_FORMAT(o.created_at, '%Y-%m-%d')) AS active_sale_days,
              MIN(o.created_at) AS first_consumption_at
         FROM order_inventory_consumptions oic
         JOIN orders o ON o.id = oic.order_id
        WHERE oic.reversed_at IS NULL
          AND o.order_status <> 'Cancelled'
          AND o.created_at >= ?
          AND o.created_at <= ?
        GROUP BY oic.inventory_item_id`,
      [windowStart, windowEnd],
    ),
  ]);

  const lowThreshold = Number(settingsRows[0]?.low_stock_threshold_pct ?? 40);
  const criticalThreshold = Number(settingsRows[0]?.critical_stock_threshold_pct ?? 20);
  const usageByItem = groupRowsByKey(unitUsageRows, "inventory_item_id");
  const metaByItem = new Map(
    usageMetaRows.map((row) => [Number(row.inventory_item_id), row]),
  );

  const candidates = [];
  for (const row of inventoryRows) {
    const itemId = Number(row.id);
    const unitRows = usageByItem.get(itemId) || [];
    let totalConsumed = 0;
    for (const usageRow of unitRows) {
      totalConsumed += convertConsumptionToStockUnit(usageRow.qty_used, usageRow.unit, row.unit);
    }
    const meta = metaByItem.get(itemId);
    const plan = computeRestockItemPlan({
      item: row,
      totalConsumed,
      ordersUsingCount: Number(meta?.orders_using_count || 0),
      activeSaleDays: Number(meta?.active_sale_days || 0),
      firstConsumptionAt: meta?.first_consumption_at || null,
      lookbackDays: cleanLookback,
      coverDays: cleanCover,
      windowStartDateStr: fromDate,
      todayDateStr: today,
      lowThreshold,
      criticalThreshold,
    });
    if (plan.shouldInclude) {
      candidates.push(plan);
    }
  }

  const rankedItems = sortRestockSuggestions(candidates).map(serializeRestockPlanItem);
  const summary = buildRestockSummary(rankedItems);

  return {
    lookbackDays: cleanLookback,
    coverDays: cleanCover,
    windowStart,
    windowEnd,
    items: rankedItems,
    summary,
  };
}
