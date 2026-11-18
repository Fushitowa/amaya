import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { normalizeTargetFoodCost } from "../utils/costing.js";
import { loadBusinessSettings } from "./settings.js";
import { round2 } from "../../../shared/units.js";
import { getManilaTodayDateStr } from "../../../shared/manilaDate.js";
import {
  addDaysIsoDate,
  buildCsvDocument,
  buildDeltaMetric,
  buildOrderWhereClause,
  diffDaysInclusive,
  formatDayLabel,
  groupRowsByKey,
  LINE_COGS_EXPR,
  parseOrderFilters,
  queryHourlySalesData,
  queryInventoryActivityData,
  queryOrdersReportData,
  queryPeriodFinancialMetrics,
  queryProductReportData,
  queryRestockSuggestions,
  resolveRange,
  UNCOSTED_CASE_EXPR,
  VALID_EXPORT_TYPES,
} from "../services/reportsQueryService.js";

const router = Router();

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
    [unconfirmedOrderRows],
    [[clockRow]],
  ] = await Promise.all([
    pool.execute("SELECT id, username, display_name, role, is_active FROM users ORDER BY id ASC"),
    pool.execute(
      `SELECT COALESCE(o.paid_by, o.created_by) AS user_id,
              COUNT(*) AS total_orders,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN 1 ELSE 0 END), 0) AS orders_count,
              COALESCE(SUM(CASE WHEN o.order_status = 'Cancelled' THEN 1 ELSE 0 END), 0) AS voided_orders_count,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' THEN o.total ELSE 0 END), 0) AS gross_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND COALESCE(o.payment_method, 'Cash') = 'Cash' THEN o.total ELSE 0 END), 0) AS cash_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'GCash' THEN o.total ELSE 0 END), 0) AS gcash_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.payment_method = 'Card' THEN o.total ELSE 0 END), 0) AS card_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.owner_confirmed_at IS NULL THEN 1 ELSE 0 END), 0) AS unconfirmed_orders_count,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.owner_confirmed_at IS NULL THEN o.total ELSE 0 END), 0) AS unconfirmed_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND COALESCE(o.payment_method, 'Cash') = 'Cash' AND o.owner_confirmed_at IS NULL THEN o.total ELSE 0 END), 0) AS unconfirmed_cash_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.owner_confirmed_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS confirmed_orders_count,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND o.owner_confirmed_at IS NOT NULL THEN o.total ELSE 0 END), 0) AS confirmed_sales,
              COALESCE(SUM(CASE WHEN o.payment_status = 'Paid' AND o.order_status <> 'Cancelled' AND COALESCE(o.payment_method, 'Cash') = 'Cash' AND o.owner_confirmed_at IS NOT NULL THEN o.total ELSE 0 END), 0) AS confirmed_cash_sales,
              MAX(o.owner_confirmed_at) AS last_owner_confirmed_at
         FROM orders o
         ${orderWhere}
        GROUP BY COALESCE(o.paid_by, o.created_by)`,
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
      `SELECT COALESCE(o.paid_by, o.created_by) AS user_id,
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
        GROUP BY COALESCE(o.paid_by, o.created_by)`,
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
    pool.execute(
      `SELECT o.id, COALESCE(o.paid_by, o.created_by) AS user_id
         FROM orders o
         ${orderWhere ? `${orderWhere} AND` : "WHERE"} o.payment_status = 'Paid'
           AND o.order_status <> 'Cancelled'
           AND o.owner_confirmed_at IS NULL
        ORDER BY o.id ASC`,
      orderParams,
    ),
    pool.execute("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS inspected_before"),
  ]);

  const inspectedBefore = clockRow?.inspected_before || null;
  const unconfirmedIdsByUser = new Map();
  for (const row of unconfirmedOrderRows) {
    if (row.user_id == null) continue;
    const uid = Number(row.user_id);
    if (!unconfirmedIdsByUser.has(uid)) unconfirmedIdsByUser.set(uid, []);
    unconfirmedIdsByUser.get(uid).push(Number(row.id));
  }

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

    const unconfirmedOrdersCount = Number(ord?.unconfirmed_orders_count || 0);
    const hasActivity = ordersCount > 0 || voidedOrdersCount > 0 || voidActionsCount > 0 || sessionsCount > 0 || inventoryActionsCount > 0 || unconfirmedOrdersCount > 0;
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
      unconfirmedOrdersCount: Number(ord?.unconfirmed_orders_count || 0),
      unconfirmedOrderIds: unconfirmedIdsByUser.get(uid) || [],
      inspectedBefore,
      unconfirmedSales: round2(ord?.unconfirmed_sales),
      unconfirmedCashSales: round2(ord?.unconfirmed_cash_sales),
      confirmedOrdersCount: Number(ord?.confirmed_orders_count || 0),
      confirmedSales: round2(ord?.confirmed_sales),
      confirmedCashSales: round2(ord?.confirmed_cash_sales),
      lastOwnerConfirmedAt: ord?.last_owner_confirmed_at ? new Date(ord.last_owner_confirmed_at).toISOString() : null,
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
      acc.unconfirmedOrdersCount += row.unconfirmedOrdersCount;
      acc.unconfirmedSales = round2(acc.unconfirmedSales + row.unconfirmedSales);
      acc.unconfirmedCashSales = round2(acc.unconfirmedCashSales + row.unconfirmedCashSales);
      acc.confirmedOrdersCount += row.confirmedOrdersCount;
      acc.confirmedSales = round2(acc.confirmedSales + row.confirmedSales);
      acc.confirmedCashSales = round2(acc.confirmedCashSales + row.confirmedCashSales);
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
      unconfirmedOrdersCount: 0,
      unconfirmedSales: 0,
      unconfirmedCashSales: 0,
      confirmedOrdersCount: 0,
      confirmedSales: 0,
      confirmedCashSales: 0,
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
    [unconfirmedRows],
    [[clockRow]],
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
              COALESCE(NULLIF(uoc.display_name, ''), uoc.username) AS owner_confirmed_by_name,
              COALESCE(NULLIF(uv.display_name, ''), uv.username) AS voided_by_name
         FROM orders o
         LEFT JOIN users u ON u.id = o.created_by
         LEFT JOIN users uoc ON uoc.id = o.owner_confirmed_by
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
    pool.execute(
      `SELECT o.id
         FROM orders o
         ${paidCondition}
           AND o.owner_confirmed_at IS NULL
        ORDER BY o.id ASC`,
      orderParams,
    ),
    pool.execute("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS inspected_before"),
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

  const staffItemsByOrderId = groupRowsByKey(orderItems, "order_id");
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
      unconfirmedOrderIds: unconfirmedRows.map((row) => Number(row.id)),
      inspectedBefore: clockRow?.inspected_before || null,
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
        numericId: Number(order.id),
        customer: order.customer_name,
        cashier: order.cashier_name || order.creator_display_name || displayName,
        createdById: order.created_by == null ? null : Number(order.created_by),
        paidById: order.paid_by == null ? null : Number(order.paid_by),
        total: Number(order.total),
        status: order.order_status,
        type: order.order_type,
        payment: order.payment_status,
        paymentMethod: order.payment_method,
        ownerConfirmed: Boolean(order.owner_confirmed_at),
        ownerConfirmedAt: order.owner_confirmed_at ? new Date(order.owner_confirmed_at).toISOString() : null,
        ownerConfirmedBy: order.owner_confirmed_by == null ? null : Number(order.owner_confirmed_by),
        ownerConfirmedByName: order.owner_confirmed_by_name || null,
        ownerConfirmationNote: order.owner_confirmation_note || "",
        voidedByName: order.voided_by_name || null,
        voidReason: order.void_reason || null,
        notes: order.notes || null,
        sessionId: order.session_id == null ? null : Number(order.session_id),
        createdAt: new Date(order.created_at).toISOString(),
        items: (staffItemsByOrderId.get(Number(order.id)) || []).map((item) => ({
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

router.post("/staff/:id/confirm-sales", requireAuth, requireRole("admin"), async (request, response) => {
  const staffId = Number(request.params.id);
  if (!Number.isSafeInteger(staffId) || staffId <= 0) {
    throw httpError(400, "Invalid staff user ID.");
  }

  const [[userRow]] = await pool.execute(
    "SELECT id, username, display_name, role, is_active FROM users WHERE id = ? LIMIT 1",
    [staffId],
  );
  if (!userRow) throw httpError(404, "Staff user not found.");

  const rawNote = request.body?.note != null ? String(request.body.note).trim() : "";
  if (rawNote.length > 255) {
    throw httpError(400, "Confirmation note must be 255 characters or fewer.");
  }
  const cleanNote = rawNote || "Owner confirmed cashier sales remittance";
  const actorId = request.authUser.sub;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin (Owner)";

  const conditions = [
    "COALESCE(paid_by, created_by) = ?",
    "payment_status = 'Paid'",
    "order_status <> 'Cancelled'",
    "owner_confirmed_at IS NULL",
  ];
  const params = [staffId];

  if (request.body?.scope === "range") {
    const range = resolveRange(request.body);
    if (range.start && range.end) {
      conditions.push("created_at BETWEEN ? AND ?");
      params.push(range.start, range.end);
    }
  }

  const rawInspectedBefore = request.body?.inspectedBefore ?? request.body?.cutoffAt;
  if (rawInspectedBefore !== undefined && rawInspectedBefore !== null && String(rawInspectedBefore).trim() !== "") {
    const rawStr = String(rawInspectedBefore).trim();
    let sqlCutoff;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawStr)) {
      sqlCutoff = rawStr;
    } else {
      const parsed = new Date(rawStr);
      if (Number.isNaN(parsed.getTime())) {
        throw httpError(400, "Invalid inspectedBefore timestamp.");
      }
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(parsed);
      const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
      sqlCutoff = `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
    }
    conditions.push("created_at <= ?");
    params.push(sqlCutoff);
  }

  if (request.body?.orderIds !== undefined) {
    if (!Array.isArray(request.body.orderIds) || request.body.orderIds.length === 0) {
      throw httpError(400, "Select at least one inspected order to confirm.");
    }
    const validIds = [...new Set(
      request.body.orderIds
        .map((val) => Number(val))
        .filter((val) => Number.isSafeInteger(val) && val > 0),
    )];
    if (!validIds.length) {
      throw httpError(400, "Invalid orderIds provided.");
    }
    conditions.push(`id IN (${validIds.map(() => "?").join(",")})`);
    params.push(...validIds);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT id, order_number, order_status, total, payment_method
         FROM orders
        WHERE ${conditions.join(" AND ")}
        ORDER BY id ASC
          FOR UPDATE`,
      params,
    );

    if (rows.length === 0) {
      await connection.commit();
      response.json({
        alreadyConfirmed: true,
        staffUserId: staffId,
        confirmedOrdersCount: 0,
        confirmedSalesTotal: 0,
        confirmedCashTotal: 0,
        confirmedAt: null,
      });
      return;
    }

    const orderIds = rows.map((r) => Number(r.id));
    const marks = orderIds.map(() => "?").join(",");

    const [[cashLedgerRow]] = await connection.execute(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0.00) AS ledger_cash_total
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE coa.account_code = '1010'
          AND je.order_id IN (${marks})`,
      orderIds,
    );

    let salesSum = 0;
    let fallbackCashSum = 0;
    for (const row of rows) {
      const orderTotal = Number(row.total || 0);
      salesSum += orderTotal;
      if ((row.payment_method || "Cash") === "Cash") {
        fallbackCashSum += orderTotal;
      }
    }
    const ledgerCashTotal = Number(cashLedgerRow?.ledger_cash_total || 0);
    const cashSum = ledgerCashTotal > 0 ? ledgerCashTotal : fallbackCashSum;

    await connection.execute(
      `UPDATE orders
          SET owner_confirmed_at = CURRENT_TIMESTAMP,
              owner_confirmed_by = ?,
              owner_confirmation_note = ?
        WHERE id IN (${marks})`,
      [actorId, cleanNote, ...orderIds],
    );

    for (const row of rows) {
      await connection.execute(
        `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.order_status,
          row.order_status,
          actorId,
          actorName.slice(0, 100),
          cleanNote.slice(0, 255),
        ],
      );
    }

    await connection.commit();
    response.json({
      alreadyConfirmed: false,
      staffUserId: staffId,
      confirmedOrdersCount: rows.length,
      confirmedSalesTotal: round2(salesSum),
      confirmedCashTotal: round2(cashSum),
      confirmedAt: new Date().toISOString(),
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.get("/hourly-sales", requireAuth, requireRole("admin"), async (request, response) => {
  response.json(await queryHourlySalesData(request.query));
});

router.get("/products", requireAuth, requireRole("admin"), async (request, response) => {
  const range = resolveRange(request.query);
  const { items, totals, total, page, limit } = await queryProductReportData(range, request.query, { paginate: true });

  response.json({
    range: {
      rangeKey: range.rangeKey,
      from: range.from,
      to: range.to,
    },
    items,
    total,
    page,
    limit,
    totals,
    uncostedItemsCount: totals.uncostedItemsCount,
  });
});

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

function parseBoundedIntParam(rawValue, defaultValue, min, max, label) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return defaultValue;
  }
  const clean = String(rawValue).trim();
  if (!/^\d+$/.test(clean)) {
    throw httpError(400, `Invalid ${label}. Expected an integer between ${min} and ${max}.`);
  }
  const parsed = Number(clean);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw httpError(400, `Invalid ${label}. Expected an integer between ${min} and ${max}.`);
  }
  return parsed;
}

router.get("/restock-suggestions", requireAuth, requireRole("admin"), async (request, response) => {
  const lookbackDays = parseBoundedIntParam(request.query?.lookbackDays, 14, 1, 90, "lookbackDays");
  const coverDays = parseBoundedIntParam(request.query?.coverDays, 7, 1, 60, "coverDays");
  const data = await queryRestockSuggestions({ lookbackDays, coverDays });
  response.json(data);
});

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
    const data = await queryOrdersReportData(range, request.query, {
      paginate: false,
      maxRows: exportRowLimit,
      includeItems: false,
    });
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
