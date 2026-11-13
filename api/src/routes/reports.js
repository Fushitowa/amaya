import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { normalizeTargetFoodCost } from "../utils/costing.js";
import { loadBusinessSettings } from "./settings.js";

const router = Router();

const VALID_RANGE_KEYS = new Set(["today", "7d", "30d", "all", "custom"]);
const VALID_PAYMENT_METHODS = new Set(["Cash", "GCash", "Card"]);
const VALID_ORDER_TYPES = new Set(["Counter", "Takeout", "Dine-in"]);
const VALID_ORDER_STATUSES = new Set(["Pending", "Preparing", "Ready", "Completed", "Cancelled"]);
const VALID_MOVEMENT_TYPES = new Set(["restock", "adjustment", "usage", "spoilage", "void_restore"]);
const VALID_EXPORT_TYPES = new Set(["orders", "staff", "products", "inventory"]);

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getManilaTodayDateStr(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isValidIsoDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function addDaysIsoDate(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = String(dt.getUTCFullYear()).padStart(4, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function diffDaysInclusive(fromDate, toDate) {
  const [y1, m1, d1] = fromDate.split("-").map(Number);
  const [y2, m2, d2] = toDate.split("-").map(Number);
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.round(ms / 86_400_000) + 1;
}

function formatDayLabel(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function resolveRange(query = {}) {
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

function parseOrderFilters(query = {}) {
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

function buildOrderWhereClause({ start = null, end = null, filters = {}, alias = "o" } = {}) {
  const conditions = [];
  const params = [];

  if (start && end) {
    conditions.push(`${alias}.created_at BETWEEN ? AND ?`);
    params.push(start, end);
  }
  if (filters.staffId) {
    conditions.push(`${alias}.created_by = ?`);
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
    const term = `%${filters.search.toLowerCase()}%`;
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

const LINE_COGS_EXPR = `
  COALESCE(
    NULLIF(oic_sum.consumption_cost, 0),
    oi.quantity * COALESCE(NULLIF(oi.unit_cost_snapshot, 0), NULLIF(mp.cost_price, 0), 0)
  )
`;

const UNCOSTED_CASE_EXPR = `
  COALESCE(oic_sum.uncosted_ingredient_count, 0) > 0
  OR (
    COALESCE(oic_sum.consumption_cost, 0) <= 0
    AND COALESCE(oi.unit_cost_snapshot, 0) <= 0
    AND COALESCE(mp.cost_price, 0) <= 0
  )
`;

async function queryPeriodFinancialMetrics(bounds, filters) {
  const { whereSql, params } = buildOrderWhereClause({
    start: bounds?.start || null,
    end: bounds?.end || null,
    filters,
    alias: "o",
  });

  const [[orderAgg]] = await pool.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN o.total ELSE 0 END), 0) AS gross_collected_sales,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN 1 ELSE 0 END), 0) AS paid_orders_count,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Unpaid' AND o.order_status <> 'Cancelled' THEN 1 ELSE 0 END), 0) AS unpaid_orders_count,
       COALESCE(SUM(CASE WHEN o.order_status = 'Cancelled' THEN 1 ELSE 0 END), 0) AS voided_orders_count,
       COALESCE(SUM(CASE WHEN o.order_status = 'Cancelled' THEN o.total ELSE 0 END), 0) AS voided_sales_total,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND COALESCE(o.payment_method, 'Cash') = 'Cash' THEN o.total ELSE 0 END), 0) AS cash_collected,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'GCash' THEN o.total ELSE 0 END), 0) AS gcash_collected,
       COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'Card' THEN o.total ELSE 0 END), 0) AS card_collected
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
    itemConditions.push("o.created_by = ?");
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
    const term = `%${filters.search.toLowerCase()}%`;
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

  const grossCollectedSales = round2(orderAgg?.gross_collected_sales);
  const cogs = round2(itemAgg?.cogs);
  const grossProfit = round2(grossCollectedSales - cogs);
  const paidOrdersCount = Number(orderAgg?.paid_orders_count || 0);

  return {
    grossCollectedSales,
    cogs,
    grossProfit,
    marginPercent: grossCollectedSales > 0 ? round2((grossProfit / grossCollectedSales) * 100) : 0,
    paidOrdersCount,
    unpaidOrdersCount: Number(orderAgg?.unpaid_orders_count || 0),
    voidedOrdersCount: Number(orderAgg?.voided_orders_count || 0),
    voidedSalesTotal: round2(orderAgg?.voided_sales_total),
    unitsSold: Number(itemAgg?.units_sold || 0),
    averageOrderValue: paidOrdersCount > 0 ? round2(grossCollectedSales / paidOrdersCount) : 0,
    cashCollected: round2(orderAgg?.cash_collected),
    gcashCollected: round2(orderAgg?.gcash_collected),
    cardCollected: round2(orderAgg?.card_collected),
    uncostedItemsCount: Number(itemAgg?.uncosted_units || 0),
    uncostedLineCount: Number(itemAgg?.uncosted_lines || 0),
    inventoryExpenditure: round2(movAgg?.inventory_expenditure),
    inventoryRestockCount: Number(movAgg?.restock_count || 0),
  };
}

function buildDeltaMetric(current, previous) {
  const diff = round2(current - previous);
  const percent = previous > 0
    ? round2(((current - previous) / previous) * 100)
    : (current === 0 ? 0 : null);
  return { change: diff, percent };
}

function sanitizeCsvCell(value) {
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

function buildCsvDocument(headers, rows) {
  const lines = [
    headers.map(sanitizeCsvCell).join(","),
    ...rows.map((row) => row.map(sanitizeCsvCell).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

router.use(requireAuth, requireRole("admin"), (_request, response, next) => {
  response.set("Cache-Control", "private, no-store");
  response.set("Vary", "Authorization");
  next();
});

router.get("/financial-summary", requireAuth, requireRole("admin"), async (request, response) => {
  const range = resolveRange(request.query);
  const filters = parseOrderFilters(request.query);

  const [summary, previousSummary, invSnapshotRow, settingsRow] = await Promise.all([
    queryPeriodFinancialMetrics(range.from ? range : null, filters),
    range.previous ? queryPeriodFinancialMetrics(range.previous, filters) : Promise.resolve(null),
    pool.execute("SELECT COALESCE(SUM(quantity * unit_cost), 0) AS total_value FROM inventory_items WHERE is_archived = FALSE"),
    pool.execute("SELECT target_food_cost FROM business_settings WHERE id = 1 LIMIT 1"),
  ]);

  const inventoryAssetValue = round2(invSnapshotRow[0]?.[0]?.total_value);
  const targetFoodCost = normalizeTargetFoodCost(settingsRow[0]?.[0]?.target_food_cost);

  const fullSummary = {
    ...summary,
    inventoryAssetValue,
    targetFoodCost,
  };

  const deltas = previousSummary
    ? {
        grossCollectedSales: buildDeltaMetric(fullSummary.grossCollectedSales, previousSummary.grossCollectedSales),
        cogs: buildDeltaMetric(fullSummary.cogs, previousSummary.cogs),
        grossProfit: buildDeltaMetric(fullSummary.grossProfit, previousSummary.grossProfit),
        paidOrdersCount: buildDeltaMetric(fullSummary.paidOrdersCount, previousSummary.paidOrdersCount),
        unitsSold: buildDeltaMetric(fullSummary.unitsSold, previousSummary.unitsSold),
        averageOrderValue: buildDeltaMetric(fullSummary.averageOrderValue, previousSummary.averageOrderValue),
      }
    : null;

  const { whereSql: paidBaseWhere, params: paidBaseParams } = buildOrderWhereClause({
    start: range.start,
    end: range.end,
    filters,
    alias: "o",
  });
  const paidCondition = paidBaseWhere
    ? `${paidBaseWhere} AND o.payment_status = 'Paid' AND o.order_status <> 'Cancelled'`
    : "WHERE o.payment_status = 'Paid' AND o.order_status <> 'Cancelled'";

  const [[seriesOrderRows], [seriesCogsRows], [channelRows], [paymentRows]] = await Promise.all([
    pool.execute(
      `SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') AS bucket_date,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.total), 0) AS sales
         FROM orders o
         ${paidCondition}
        GROUP BY DATE_FORMAT(o.created_at, '%Y-%m-%d')
        ORDER BY bucket_date ASC`,
      paidBaseParams,
    ),
    pool.execute(
      `SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') AS bucket_date,
              COALESCE(SUM(${LINE_COGS_EXPR}), 0) AS cogs
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
         ${paidCondition}
        GROUP BY DATE_FORMAT(o.created_at, '%Y-%m-%d')
        ORDER BY bucket_date ASC`,
      paidBaseParams,
    ),
    pool.execute(
      `SELECT o.order_type AS type,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.total), 0) AS sales
         FROM orders o
         ${paidCondition}
        GROUP BY o.order_type
        ORDER BY sales DESC`,
      paidBaseParams,
    ),
    pool.execute(
      `SELECT COALESCE(o.payment_method, 'Cash') AS method,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.total), 0) AS sales
         FROM orders o
         ${paidCondition}
        GROUP BY COALESCE(o.payment_method, 'Cash')
        ORDER BY sales DESC`,
      paidBaseParams,
    ),
  ]);

  const seriesOrderMap = new Map(seriesOrderRows.map((row) => [row.bucket_date, row]));
  const seriesCogsMap = new Map(seriesCogsRows.map((row) => [row.bucket_date, Number(row.cogs || 0)]));
  const series = [];

  if (range.from && range.to && diffDaysInclusive(range.from, range.to) <= 90) {
    let cursor = range.from;
    while (cursor <= range.to) {
      const ord = seriesOrderMap.get(cursor);
      const sales = round2(ord?.sales);
      const cogs = round2(seriesCogsMap.get(cursor));
      series.push({
        date: cursor,
        label: formatDayLabel(cursor),
        sales,
        cogs,
        profit: round2(sales - cogs),
        orders: Number(ord?.orders_count || 0),
      });
      cursor = addDaysIsoDate(cursor, 1);
    }
  } else {
    const allDates = [...new Set([...seriesOrderMap.keys(), ...seriesCogsMap.keys()])].sort();
    for (const dateStr of allDates) {
      const ord = seriesOrderMap.get(dateStr);
      const sales = round2(ord?.sales);
      const cogs = round2(seriesCogsMap.get(dateStr));
      series.push({
        date: dateStr,
        label: formatDayLabel(dateStr),
        sales,
        cogs,
        profit: round2(sales - cogs),
        orders: Number(ord?.orders_count || 0),
      });
    }
  }

  const totalPaidSales = fullSummary.grossCollectedSales;
  const channels = channelRows.map((row) => {
    const sales = round2(row.sales);
    return {
      type: row.type,
      ordersCount: Number(row.orders_count || 0),
      sales,
      sharePercent: totalPaidSales > 0 ? round2((sales / totalPaidSales) * 100) : 0,
    };
  });
  const payments = paymentRows.map((row) => {
    const sales = round2(row.sales);
    return {
      method: row.method,
      ordersCount: Number(row.orders_count || 0),
      sales,
      sharePercent: totalPaidSales > 0 ? round2((sales / totalPaidSales) * 100) : 0,
    };
  });

  response.json({
    range: {
      rangeKey: range.rangeKey,
      from: range.from,
      to: range.to,
      previousFrom: range.previous?.from || null,
      previousTo: range.previous?.to || null,
    },
    summary: fullSummary,
    previousSummary,
    deltas,
    series,
    channels,
    payments,
  });
});

async function queryStaffPerformanceData(range, query = {}) {
  const filters = parseOrderFilters(query);
  const roleFilter = String(query.role || "all").trim().toLowerCase();
  if (!["all", "staff", "admin"].includes(roleFilter)) {
    throw httpError(400, "Invalid role filter. Expected all, staff, or admin.");
  }
  const activeFilter = String(query.isActive || "all").trim().toLowerCase();
  if (!["all", "active", "inactive"].includes(activeFilter)) {
    throw httpError(400, "Invalid isActive filter. Expected all, active, or inactive.");
  }
  const search = filters.search ? filters.search.toLowerCase() : null;

  const { whereSql: orderWhere, params: orderParams } = buildOrderWhereClause({
    start: range.start,
    end: range.end,
    filters: {
      paymentMethod: filters.paymentMethod,
      orderType: filters.orderType,
      status: filters.status,
    },
    alias: "o",
  });

  const itemConditions = ["o.payment_status = 'Paid'", "o.order_status <> 'Cancelled'"];
  const itemParams = [];
  if (range.start && range.end) {
    itemConditions.push("o.created_at BETWEEN ? AND ?");
    itemParams.push(range.start, range.end);
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

  const sessionRangeSql = range.start && range.end ? "WHERE cs.opened_at BETWEEN ? AND ?" : "";
  const sessionParams = range.start && range.end ? [range.start, range.end] : [];

  const movRangeSql = range.start && range.end ? "WHERE m.created_at BETWEEN ? AND ?" : "";
  const movParams = range.start && range.end ? [range.start, range.end] : [];

  const [
    [userRows],
    [orderByCreatorRows],
    [voidByActorRows],
    [itemByCreatorRows],
    [sessionByUserRows],
    [movByUserRows],
  ] = await Promise.all([
    pool.execute("SELECT id, username, display_name, role, is_active FROM users ORDER BY id ASC"),
    pool.execute(
      `SELECT o.created_by AS user_id,
              COUNT(*) AS total_orders,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN 1 ELSE 0 END), 0) AS orders_count,
              COALESCE(SUM(CASE WHEN o.order_status = 'Cancelled' THEN 1 ELSE 0 END), 0) AS voided_orders_count,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN o.total ELSE 0 END), 0) AS gross_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'Cash' THEN o.total ELSE 0 END), 0) AS cash_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'GCash' THEN o.total ELSE 0 END), 0) AS gcash_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'Card' THEN o.total ELSE 0 END), 0) AS card_sales
         FROM orders o
         ${orderWhere}
        GROUP BY o.created_by`,
      orderParams,
    ),
    pool.execute(
      `SELECT o.voided_by AS user_id, COUNT(*) AS void_actions_count
         FROM orders o
         ${orderWhere ? `${orderWhere} AND` : "WHERE"} o.order_status = 'Cancelled' AND o.voided_by IS NOT NULL
        GROUP BY o.voided_by`,
      orderParams,
    ),
    pool.execute(
      `SELECT o.created_by AS user_id,
              COALESCE(SUM(oi.quantity), 0) AS units_sold,
              COALESCE(SUM(${LINE_COGS_EXPR}), 0) AS cogs,
              COALESCE(SUM(CASE WHEN ${UNCOSTED_CASE_EXPR} THEN oi.quantity ELSE 0 END), 0) AS uncosted_units
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
        WHERE ${itemConditions.join(" AND ")}
        GROUP BY o.created_by`,
      itemParams,
    ),
    pool.execute(
      `SELECT cs.user_id, COUNT(*) AS sessions_count
         FROM cashier_sessions cs
         ${sessionRangeSql}
        GROUP BY cs.user_id`,
      sessionParams,
    ),
    pool.execute(
      `SELECT m.user_id, COUNT(*) AS inventory_actions_count
         FROM inventory_movements m
         ${movRangeSql}
        GROUP BY m.user_id`,
      movParams,
    ),
  ]);

  const orderMap = new Map();
  let unassignedOrdersCount = 0;
  let unassignedGrossSales = 0;
  for (const row of orderByCreatorRows) {
    if (row.user_id == null) {
      unassignedOrdersCount += Number(row.orders_count || 0);
      unassignedGrossSales += Number(row.gross_sales || 0);
    } else {
      orderMap.set(Number(row.user_id), row);
    }
  }
  const voidActionMap = new Map(voidByActorRows.map((row) => [Number(row.user_id), Number(row.void_actions_count || 0)]));
  const itemMap = new Map();
  for (const row of itemByCreatorRows) {
    if (row.user_id != null) {
      itemMap.set(Number(row.user_id), row);
    }
  }
  const sessionMap = new Map(sessionByUserRows.map((row) => [Number(row.user_id), Number(row.sessions_count || 0)]));
  const movMap = new Map();
  for (const row of movByUserRows) {
    if (row.user_id != null) {
      movMap.set(Number(row.user_id), Number(row.inventory_actions_count || 0));
    }
  }

  let totalGrossSales = 0;
  for (const row of orderByCreatorRows) {
    totalGrossSales += Number(row.gross_sales || 0);
  }
  totalGrossSales = round2(totalGrossSales);

  const rawStaff = [];
  for (const user of userRows) {
    const uid = Number(user.id);
    const ord = orderMap.get(uid);
    const itm = itemMap.get(uid);
    const sessionsCount = sessionMap.get(uid) || 0;
    const inventoryActionsCount = movMap.get(uid) || 0;
    const voidActionsCount = voidActionMap.get(uid) || 0;
    const ordersCount = Number(ord?.orders_count || 0);
    const voidedOrdersCount = Number(ord?.voided_orders_count || 0);

    const hasActivity = ordersCount > 0 || voidedOrdersCount > 0 || voidActionsCount > 0 || sessionsCount > 0 || inventoryActionsCount > 0;
    if (user.role === "admin" && roleFilter !== "admin" && !hasActivity) {
      continue;
    }
    if (roleFilter !== "all" && user.role !== roleFilter) continue;
    const isActive = Boolean(user.is_active);
    if (activeFilter === "active" && !isActive) continue;
    if (activeFilter === "inactive" && isActive) continue;

    const displayName = user.display_name || user.username;
    if (search && !displayName.toLowerCase().includes(search)) continue;

    const rawRowGrossSales = Number(ord?.gross_sales || 0);
    const rawRowCogs = Number(itm?.cogs || 0);
    const grossSales = round2(rawRowGrossSales);
    const cogs = round2(rawRowCogs);
    const attributedGrossProfit = round2(rawRowGrossSales - rawRowCogs);

    rawStaff.push({
      userId: uid,
      displayName,
      role: user.role,
      isActive,
      ordersCount,
      voidedOrdersCount,
      voidActionsCount,
      grossSales,
      cogs,
      // Business KPI only — measures store profit on orders attributed to this account, never staff pay/commissions.
      attributedGrossProfit,
      marginPercent: grossSales > 0 ? round2((attributedGrossProfit / grossSales) * 100) : 0,
      averageTicket: ordersCount > 0 ? round2(grossSales / ordersCount) : 0,
      unitsSold: Number(itm?.units_sold || 0),
      sharePercent: totalGrossSales > 0 ? round2((grossSales / totalGrossSales) * 100) : 0,
      cashSales: round2(ord?.cash_sales),
      gcashSales: round2(ord?.gcash_sales),
      cardSales: round2(ord?.card_sales),
      sessionsCount,
      inventoryActionsCount,
      uncostedItemsCount: Number(itm?.uncosted_units || 0),
      _rawGrossSales: rawRowGrossSales,
      _rawCogs: rawRowCogs,
    });
  }

  const sortBy = String(query.sortBy || "grossSales").trim();
  const sortDir = String(query.sortDir || "desc").trim().toLowerCase() === "asc" ? 1 : -1;
  rawStaff.sort((a, b) => {
    if (sortBy === "displayName") {
      return a.displayName.localeCompare(b.displayName) * sortDir;
    }
    const keyMap = {
      grossSales: "grossSales",
      ordersCount: "ordersCount",
      attributedGrossProfit: "attributedGrossProfit",
      averageTicket: "averageTicket",
      unitsSold: "unitsSold",
      sessionsCount: "sessionsCount",
      inventoryActionsCount: "inventoryActionsCount",
    };
    const field = keyMap[sortBy] || "grossSales";
    if (a[field] !== b[field]) return (a[field] - b[field]) * sortDir;
    return a.userId - b.userId;
  });

  const totals = rawStaff.reduce(
    (acc, row) => {
      acc.ordersCount += row.ordersCount;
      acc.voidedOrdersCount += row.voidedOrdersCount;
      acc._rawSales += row._rawGrossSales;
      acc._rawCogs += row._rawCogs;
      acc.unitsSold += row.unitsSold;
      acc.sessionsCount += row.sessionsCount;
      acc.inventoryActionsCount += row.inventoryActionsCount;
      acc.uncostedItemsCount += row.uncostedItemsCount;
      delete row._rawGrossSales;
      delete row._rawCogs;
      return acc;
    },
    {
      ordersCount: 0,
      voidedOrdersCount: 0,
      grossSales: 0,
      cogs: 0,
      attributedGrossProfit: 0,
      unitsSold: 0,
      sessionsCount: 0,
      inventoryActionsCount: 0,
      uncostedItemsCount: 0,
      unassignedOrdersCount,
      unassignedGrossSales: round2(unassignedGrossSales),
      _rawSales: 0,
      _rawCogs: 0,
    },
  );
  totals.grossSales = round2(totals._rawSales);
  totals.cogs = round2(totals._rawCogs);
  totals.attributedGrossProfit = round2(totals._rawSales - totals._rawCogs);
  delete totals._rawSales;
  delete totals._rawCogs;

  return { staff: rawStaff, totals };
}

router.get("/staff-performance", requireAuth, requireRole("admin"), async (request, response) => {
  const range = resolveRange(request.query);
  const { staff, totals } = await queryStaffPerformanceData(range, request.query);
  response.json({
    range: {
      rangeKey: range.rangeKey,
      from: range.from,
      to: range.to,
    },
    kpiNote: "Attributed Gross Profit is a store performance KPI (Sales minus COGS on attributed orders) and does not represent staff wages or commissions.",
    staff,
    totals,
  });
});

router.get("/staff/:id/activity", requireAuth, requireRole("admin"), async (request, response) => {
  const userId = Number(request.params.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw httpError(400, "Invalid staff user ID.");
  }

  const [[userRow]] = await pool.execute(
    "SELECT id, username, display_name, role, is_active, created_at FROM users WHERE id = ? LIMIT 1",
    [userId],
  );
  if (!userRow) throw httpError(404, "Staff user not found.");

  const range = resolveRange(request.query);
  const filters = parseOrderFilters({ ...request.query, staffId: String(userId) });
  const page = Math.max(1, Number.parseInt(request.query?.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(request.query?.limit, 10) || 25));
  const offset = (page - 1) * limit;

  const summary = await queryPeriodFinancialMetrics(range.from ? range : null, filters);

  const { whereSql: orderWhere, params: orderParams } = buildOrderWhereClause({
    start: range.start,
    end: range.end,
    filters,
    alias: "o",
  });
  const paidCondition = orderWhere
    ? `${orderWhere} AND o.payment_status = 'Paid' AND o.order_status <> 'Cancelled'`
    : "WHERE o.payment_status = 'Paid' AND o.order_status <> 'Cancelled'";

  const sessionRangeConditions = ["cs.user_id = ?"];
  const sessionParams = [userId];
  if (range.start && range.end) {
    sessionRangeConditions.push("cs.opened_at BETWEEN ? AND ?");
    sessionParams.push(range.start, range.end);
  }

  const movRangeConditions = ["m.user_id = ?"];
  const movParams = [userId];
  if (range.start && range.end) {
    movRangeConditions.push("m.created_at BETWEEN ? AND ?");
    movParams.push(range.start, range.end);
  }

  const stageConditions = ["e.changed_by = ?"];
  const stageParams = [userId];
  if (range.start && range.end) {
    stageConditions.push("e.created_at BETWEEN ? AND ?");
    stageParams.push(range.start, range.end);
  }

  const [
    [paymentRows],
    [productRows],
    [seriesOrderRows],
    [seriesCogsRows],
    [orderCountRows],
    [orderRows],
    [sessionRows],
    [sessionCountRows],
    [movementRows],
    [movementCountRows],
    [stageRows],
    [stageCountRows],
  ] = await Promise.all([
    pool.execute(
      `SELECT COALESCE(o.payment_method, 'Cash') AS method,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.total), 0) AS sales
         FROM orders o
         ${paidCondition}
        GROUP BY COALESCE(o.payment_method, 'Cash')
        ORDER BY sales DESC`,
      orderParams,
    ),
    pool.execute(
      `SELECT oi.product_id,
              oi.product_name_snapshot,
              oi.size_label,
              COALESCE(SUM(oi.quantity), 0) AS units_sold,
              COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS sales,
              COALESCE(SUM(${LINE_COGS_EXPR}), 0) AS cogs
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
         ${paidCondition}
        GROUP BY oi.product_id, oi.product_name_snapshot, oi.size_label
        ORDER BY sales DESC, units_sold DESC`,
      orderParams,
    ),
    pool.execute(
      `SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') AS bucket_date,
              COUNT(*) AS orders_count,
              COALESCE(SUM(o.total), 0) AS sales
         FROM orders o
         ${paidCondition}
        GROUP BY DATE_FORMAT(o.created_at, '%Y-%m-%d')
        ORDER BY bucket_date ASC`,
      orderParams,
    ),
    pool.execute(
      `SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') AS bucket_date,
              COALESCE(SUM(${LINE_COGS_EXPR}), 0) AS cogs
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
         ${paidCondition}
        GROUP BY DATE_FORMAT(o.created_at, '%Y-%m-%d')
        ORDER BY bucket_date ASC`,
      orderParams,
    ),
    pool.query(`SELECT COUNT(*) AS total FROM orders o ${orderWhere}`, orderParams),
    pool.query(
      `SELECT o.*,
              NULLIF(u.display_name, '') AS creator_display_name,
              COALESCE(NULLIF(uv.display_name, ''), uv.username) AS voided_by_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.created_by
         LEFT JOIN users uv ON uv.id = o.voided_by
         ${orderWhere}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ? OFFSET ?`,
      [...orderParams, limit, offset],
    ),
    pool.execute(
      `SELECT cs.*,
              COALESCE(os.orders_count, 0) AS orders_count,
              COALESCE(os.paid_sales, 0) AS paid_sales,
              COALESCE(os.cash_sales, 0) AS cash_sales
         FROM cashier_sessions cs
         LEFT JOIN (
           SELECT session_id,
                  COUNT(*) AS orders_count,
                  COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' THEN total ELSE 0 END), 0) AS paid_sales,
                  COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND payment_method = 'Cash' THEN total ELSE 0 END), 0) AS cash_sales
             FROM orders
            WHERE session_id IS NOT NULL
            GROUP BY session_id
         ) os ON os.session_id = cs.id
        WHERE ${sessionRangeConditions.join(" AND ")}
        ORDER BY cs.opened_at DESC, cs.id DESC
        LIMIT 100`,
      sessionParams,
    ),
    pool.execute(
      `SELECT COUNT(*) AS total FROM cashier_sessions cs WHERE ${sessionRangeConditions.join(" AND ")}`,
      sessionParams,
    ),
    pool.execute(
      `SELECT m.*,
              COALESCE(ii.name, m.item_name_snapshot) AS item_name,
              ii.unit AS current_item_unit,
              o.order_number
         FROM inventory_movements m
         LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
         LEFT JOIN orders o ON o.id = m.order_id
        WHERE ${movRangeConditions.join(" AND ")}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 100`,
      movParams,
    ),
    pool.execute(
      `SELECT COUNT(*) AS total FROM inventory_movements m WHERE ${movRangeConditions.join(" AND ")}`,
      movParams,
    ),
    pool.execute(
      `SELECT e.id, e.order_id, o.order_number, e.from_status, e.to_status, e.reason, e.created_at
         FROM order_status_events e
         JOIN orders o ON o.id = e.order_id
        WHERE ${stageConditions.join(" AND ")}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 100`,
      stageParams,
    ),
    pool.execute(
      `SELECT COUNT(*) AS total FROM order_status_events e WHERE ${stageConditions.join(" AND ")}`,
      stageParams,
    ),
  ]);

  let orderItems = [];
  if (orderRows.length > 0) {
    const orderIds = orderRows.map((o) => o.id);
    const marks = orderIds.map(() => "?").join(",");
    const [oiRes] = await pool.execute(
      `SELECT oi.*, p.name AS current_product_name
         FROM order_items oi
         LEFT JOIN menu_products p ON p.id = oi.product_id
        WHERE oi.order_id IN (${marks})
        ORDER BY oi.id`,
      orderIds,
    );
    orderItems = oiRes;
  }

  const seriesOrderMap = new Map(seriesOrderRows.map((row) => [row.bucket_date, row]));
  const seriesCogsMap = new Map(seriesCogsRows.map((row) => [row.bucket_date, Number(row.cogs || 0)]));
  const seriesDates = [...new Set([...seriesOrderMap.keys(), ...seriesCogsMap.keys()])].sort();
  const series = seriesDates.map((dateStr) => {
    const ord = seriesOrderMap.get(dateStr);
    const sales = round2(ord?.sales);
    const cogs = round2(seriesCogsMap.get(dateStr));
    return {
      date: dateStr,
      label: formatDayLabel(dateStr),
      sales,
      cogs,
      profit: round2(sales - cogs),
      orders: Number(ord?.orders_count || 0),
    };
  });

  const displayName = userRow.display_name || userRow.username;
  response.json({
    range: {
      rangeKey: range.rangeKey,
      from: range.from,
      to: range.to,
    },
    user: {
      id: Number(userRow.id),
      displayName,
      role: userRow.role,
      isActive: Boolean(userRow.is_active),
    },
    summary: {
      ...summary,
      attributedGrossProfit: summary.grossProfit,
      inventoryActionsCount: Number(movementCountRows?.[0]?.total ?? movementRows.length),
      sessionsCount: Number(sessionCountRows?.[0]?.total ?? sessionRows.length),
      stageActionsCount: Number(stageCountRows?.[0]?.total ?? stageRows.length),
    },
    paymentBreakdown: paymentRows.map((row) => ({
      method: row.method,
      ordersCount: Number(row.orders_count || 0),
      sales: round2(row.sales),
    })),
    productBreakdown: productRows.map((row) => {
      const sales = round2(row.sales);
      const cogs = round2(row.cogs);
      return {
        productId: row.product_id == null ? null : Number(row.product_id),
        productName: row.product_name_snapshot,
        sizeLabel: row.size_label || "Regular",
        unitsSold: Number(row.units_sold || 0),
        sales,
        cogs,
        grossProfit: round2(sales - cogs),
      };
    }),
    series,
    orders: {
      items: orderRows.map((order) => ({
        id: order.order_number,
        customer: order.customer_name,
        cashier: order.cashier_name || order.creator_display_name || displayName,
        createdById: order.created_by == null ? null : Number(order.created_by),
        total: Number(order.total),
        status: order.order_status,
        type: order.order_type,
        payment: order.payment_status,
        paymentMethod: order.payment_method,
        voidedByName: order.voided_by_name || null,
        voidReason: order.void_reason || null,
        notes: order.notes || null,
        sessionId: order.session_id == null ? null : Number(order.session_id),
        createdAt: new Date(order.created_at).toISOString(),
        items: orderItems
          .filter((item) => Number(item.order_id) === Number(order.id))
          .map((item) => ({
            id: Number(item.id),
            productId: item.product_id == null ? null : Number(item.product_id),
            title: item.product_name_snapshot || item.current_product_name,
            quantity: Number(item.quantity),
            price: Number(item.unit_price),
            unitCost: item.unit_cost_snapshot == null ? null : Number(item.unit_cost_snapshot),
            size: item.size_label,
          })),
      })),
      total: Number(orderCountRows[0]?.total || 0),
      page,
      limit,
    },
    sessions: sessionRows.map((row) => {
      const openingFloat = Number(row.opening_float || 0);
      const cashSales = Number(row.cash_sales || 0);
      return {
        id: Number(row.id),
        terminalLabel: row.terminal_label,
        status: row.status,
        openedAt: new Date(row.opened_at).toISOString(),
        closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
        openingFloat,
        expectedCash: row.expected_cash != null ? Number(row.expected_cash) : round2(openingFloat + cashSales),
        countedCash: row.counted_cash == null ? null : Number(row.counted_cash),
        variance: row.variance == null ? null : Number(row.variance),
        ordersCount: Number(row.orders_count || 0),
        paidSales: round2(row.paid_sales),
      };
    }),
    inventoryActivity: movementRows.map((row) => ({
      id: Number(row.id),
      itemId: Number(row.inventory_item_id),
      itemName: row.item_name || row.item_name_snapshot || "Unknown Item",
      type: row.movement_type,
      quantityChange: Number(row.quantity_change),
      beforeQuantity: row.before_quantity == null ? null : Number(row.before_quantity),
      afterQuantity: row.after_quantity == null ? null : Number(row.after_quantity),
      unit: row.unit || row.current_item_unit || null,
      batchCost: row.batch_cost == null ? null : Number(row.batch_cost),
      supplierName: row.supplier_name || null,
      referenceNo: row.reference_no || null,
      orderId: row.order_id == null ? null : Number(row.order_id),
      orderNumber: row.order_number || null,
      note: row.note || "",
      timestamp: new Date(row.created_at).toISOString(),
    })),
    stageActions: stageRows.map((row) => ({
      id: Number(row.id),
      orderNumber: row.order_number,
      fromStatus: row.from_status || null,
      toStatus: row.to_status,
      reason: row.reason || null,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  });
});

async function queryProductReportData(range, query = {}) {
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
    conditions.push("o.created_by = ?");
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
    const term = `%${filters.search.toLowerCase()}%`;
    conditions.push("(LOWER(oi.product_name_snapshot) LIKE ? OR LOWER(COALESCE(oi.category_name_snapshot, '')) LIKE ?)");
    params.push(term, term);
  }

  const [rows] = await pool.execute(
    `SELECT oi.product_id,
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
      GROUP BY oi.product_id, oi.product_name_snapshot, COALESCE(oi.size_label, 'Regular'), COALESCE(oi.category_name_snapshot, 'Menu item')`,
    params,
  );

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

  const sortBy = String(query.sortBy || "sales").trim();
  const sortDir = String(query.sortDir || "desc").trim().toLowerCase() === "asc" ? 1 : -1;
  mapped.sort((a, b) => {
    if (sortBy === "productName") {
      return a.productName.localeCompare(b.productName) * sortDir;
    }
    const keyMap = {
      sales: "sales",
      unitsSold: "unitsSold",
      grossProfit: "grossProfit",
      cogs: "cogs",
      marginPercent: "marginPercent",
    };
    const field = keyMap[sortBy] || "sales";
    if (a[field] !== b[field]) return (a[field] - b[field]) * sortDir;
    return b.unitsSold - a.unitsSold;
  });

  const totals = mapped.reduce(
    (acc, row) => {
      acc.unitsSold += row.unitsSold;
      acc.sales = round2(acc.sales + row.sales);
      acc.baseSales = round2(acc.baseSales + row.baseSales);
      acc.addonSales = round2(acc.addonSales + row.addonSales);
      acc.cogs = round2(acc.cogs + row.cogs);
      acc.grossProfit = round2(acc.grossProfit + row.grossProfit);
      acc.uncostedItemsCount += row.uncostedItemsCount;
      return acc;
    },
    { unitsSold: 0, sales: 0, baseSales: 0, addonSales: 0, cogs: 0, grossProfit: 0, uncostedItemsCount: 0 },
  );

  return { items: mapped, totals };
}

router.get("/products", requireAuth, requireRole("admin"), async (request, response) => {
  const range = resolveRange(request.query);
  const { items, totals } = await queryProductReportData(range, request.query);
  const page = Math.max(1, Number.parseInt(request.query?.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(request.query?.limit, 10) || 100));
  const offset = (page - 1) * limit;

  response.json({
    range: {
      rangeKey: range.rangeKey,
      from: range.from,
      to: range.to,
    },
    items: items.slice(offset, offset + limit),
    total: items.length,
    page,
    limit,
    totals,
    uncostedItemsCount: totals.uncostedItemsCount,
  });
});

async function queryOrdersReportData(range, query = {}, { paginate = true, maxRows = 5000 } = {}) {
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
           COALESCE(NULLIF(uco.display_name, ''), uco.username) AS completed_by_name,
           COALESCE(NULLIF(uv.display_name, ''), uv.username) AS voided_by_name
      FROM orders o
      LEFT JOIN users u ON u.id = o.created_by
      LEFT JOIN users uc ON uc.id = o.confirmed_by
      LEFT JOIN users up ON up.id = o.paid_by
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
  if (orderRows.length > 0) {
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

  const items = orderRows.map((order) => {
    const cashier = order.cashier_name || order.creator_display_name || "Staff";
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
      cashTendered: order.cash_tendered == null ? null : Number(order.cash_tendered),
      changeDue: order.change_due == null ? null : Number(order.change_due),
      cash_tendered: order.cash_tendered == null ? null : Number(order.cash_tendered),
      change_due: order.change_due == null ? null : Number(order.change_due),
      createdAt: new Date(order.created_at).toISOString(),
      items: orderItems
        .filter((item) => Number(item.order_id) === Number(order.id))
        .map((item) => ({
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
          addons: orderAddons
            .filter((addon) => Number(addon.order_item_id) === Number(item.id))
            .map((addon) => addon.addon_name_snapshot),
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

router.get("/orders", requireAuth, requireRole("admin"), async (request, response) => {
  const range = resolveRange(request.query);
  const data = await queryOrdersReportData(range, request.query, { paginate: true });
  response.json({
    range: {
      rangeKey: range.rangeKey,
      from: range.from,
      to: range.to,
    },
    ...data,
  });
});

async function queryInventoryActivityData(range, query = {}, { paginate = true, maxRows = 5000 } = {}) {
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
    const term = `%${String(search).trim().toLowerCase()}%`;
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
              COALESCE(SUM(CASE WHEN m.movement_type = 'void_restore' THEN 1 ELSE 0 END), 0) AS total_void_restore_count
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

router.get("/inventory-activity", requireAuth, requireRole("admin"), async (request, response) => {
  const range = resolveRange(request.query);
  const data = await queryInventoryActivityData(range, request.query, { paginate: true });
  response.json({
    range: {
      rangeKey: range.rangeKey,
      from: range.from,
      to: range.to,
    },
    ...data,
  });
});

router.get("/export.csv", requireAuth, requireRole("admin"), async (request, response) => {
  const exportType = String(request.query?.type || "orders").trim().toLowerCase();
  if (!VALID_EXPORT_TYPES.has(exportType)) {
    throw httpError(400, "Invalid export type. Expected orders, staff, products, or inventory.");
  }

  const bizSettings = await loadBusinessSettings().catch(() => ({ exportRowLimit: 5000 }));
  const exportRowLimit = Math.min(25000, Math.max(100, Number(bizSettings?.exportRowLimit) || 5000));
  const range = resolveRange(request.query);
  let csvContent;
  let totalCount;
  let exportedCount;

  if (exportType === "orders") {
    const data = await queryOrdersReportData(range, request.query, { paginate: false, maxRows: exportRowLimit });
    totalCount = data.total;
    exportedCount = data.items.length;
    const headers = [
      "Order Number",
      "Created At",
      "Customer",
      "Cashier",
      "Order Type",
      "Order Status",
      "Payment Status",
      "Payment Method",
      "Total",
      "Voided By",
      "Void Reason",
      "Notes",
    ];
    const rows = data.items.map((o) => [
      o.id,
      o.createdAt,
      o.customer,
      o.cashier,
      o.type,
      o.status,
      o.payment,
      o.paymentMethod || "",
      o.total,
      o.voidedByName || "",
      o.voidReason || "",
      o.notes || "",
    ]);
    csvContent = buildCsvDocument(headers, rows);
  } else if (exportType === "staff") {
    const data = await queryStaffPerformanceData(range, request.query);
    totalCount = data.staff.length;
    exportedCount = data.staff.length;
    const headers = [
      "Staff ID",
      "Display Name",
      "Role",
      "Active",
      "Paid Orders",
      "Voided Orders",
      "Units Sold",
      "Gross Collected Sales",
      "COGS",
      "Attributed Order Gross Profit (Business KPI)",
      "Margin %",
      "Avg Ticket",
      "Cash Sales",
      "GCash Sales",
      "Card Sales",
      "Sessions",
      "Inventory Actions",
    ];
    const rows = data.staff.map((s) => [
      s.userId,
      s.displayName,
      s.role,
      s.isActive ? "Active" : "Inactive",
      s.ordersCount,
      s.voidedOrdersCount,
      s.unitsSold,
      s.grossSales,
      s.cogs,
      s.attributedGrossProfit,
      s.marginPercent,
      s.averageTicket,
      s.cashSales,
      s.gcashSales,
      s.cardSales,
      s.sessionsCount,
      s.inventoryActionsCount,
    ]);
    csvContent = buildCsvDocument(headers, rows);
  } else if (exportType === "products") {
    const data = await queryProductReportData(range, request.query);
    totalCount = data.items.length;
    exportedCount = data.items.length;
    const headers = [
      "Product ID",
      "Product Name",
      "Size",
      "Category",
      "Orders",
      "Units Sold",
      "Gross Sales",
      "Base Sales",
      "Add-on Sales",
      "COGS",
      "Gross Profit",
      "Margin %",
      "Uncosted Units",
    ];
    const rows = data.items.map((p) => [
      p.productId ?? "",
      p.productName,
      p.sizeLabel,
      p.category,
      p.ordersCount,
      p.unitsSold,
      p.sales,
      p.baseSales,
      p.addonSales,
      p.cogs,
      p.grossProfit,
      p.marginPercent,
      p.uncostedItemsCount,
    ]);
    csvContent = buildCsvDocument(headers, rows);
  } else {
    const data = await queryInventoryActivityData(
      range,
      { ...request.query, type: request.query?.movementType ?? "" },
      { paginate: false, maxRows: exportRowLimit },
    );
    totalCount = data.total;
    exportedCount = data.items.length;
    const headers = [
      "Movement ID",
      "Timestamp",
      "Item",
      "Type",
      "Quantity Change",
      "Before Quantity",
      "After Quantity",
      "Unit",
      "Batch Cost",
      "Supplier",
      "Reference No",
      "Order Number",
      "Actor",
      "Note",
    ];
    const rows = data.items.map((m) => [
      m.id,
      m.timestamp,
      m.itemName,
      m.type,
      m.quantityChange,
      m.beforeQuantity ?? "",
      m.afterQuantity ?? "",
      m.unit || "",
      m.batchCost ?? "",
      m.supplierName || "",
      m.referenceNo || "",
      m.orderNumber || "",
      m.actor,
      m.note,
    ]);
    csvContent = buildCsvDocument(headers, rows);
  }

  const stamp = getManilaTodayDateStr();
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="amaya-${exportType}-report-${stamp}.csv"`);
  response.setHeader("X-Export-Truncated", totalCount > exportedCount ? "true" : "false");
  response.setHeader("X-Export-Total", String(totalCount));
  response.setHeader("X-Export-Count", String(exportedCount));
  response.send(csvContent);
});

export default router;
