import { randomInt } from "node:crypto";
import pool from "../database.js";
import { httpError } from "../middleware/auth.js";

export const selectRecipe = (sizeRecipe, baseRecipe) => (sizeRecipe.length ? sizeRecipe : baseRecipe);
export const ORDER_FLOW = ["Pending", "Preparing", "Completed"];
export const VALID_ORDER_STATUSES = new Set(["Pending", "Preparing", "Completed", "Cancelled"]);
export const PAYMENT_METHODS = ["Cash", "GCash", "Card"];
export const ORDER_TYPES = ["Counter", "Takeout", "Dine-in"];

export function formatManilaOrderStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}${map.hour}${map.minute}${map.second}`;
}

export function getManilaTodayBounds() {
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return {
    start: `${todayStr} 00:00:00`,
    end: `${todayStr} 23:59:59`,
  };
}

export function normalizeBaseSizeLabel(label) {
  const cleaned = String(label || "Regular")
    .replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:fl\s*)?oz\s*\)\s*$/i, "")
    .trim()
    .toLowerCase();
  return cleaned || "regular";
}

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

const ORDER_WITH_ACTORS_SELECT = `
  SELECT orders.*,
         NULLIF(u.display_name, '') AS creator_display_name,
         COALESCE(NULLIF(uc.display_name, ''), uc.username) AS confirmed_by_name,
         COALESCE(NULLIF(up.display_name, ''), up.username) AS paid_by_name,
         COALESCE(NULLIF(uoc.display_name, ''), uoc.username) AS owner_confirmed_by_name,
         COALESCE(NULLIF(uco.display_name, ''), uco.username) AS completed_by_name,
         COALESCE(NULLIF(uv.display_name, ''), uv.username) AS voided_by_name
    FROM orders
    LEFT JOIN users u ON u.id = orders.created_by
    LEFT JOIN users uc ON uc.id = orders.confirmed_by
    LEFT JOIN users up ON up.id = orders.paid_by
    LEFT JOIN users uoc ON uoc.id = orders.owner_confirmed_by
    LEFT JOIN users uco ON uco.id = orders.completed_by
    LEFT JOIN users uv ON uv.id = orders.voided_by
`;

export function mapOrderRecord(
  order,
  orderItemsList,
  addonsByItemId,
  { includeCost = false, includeDetails = false, statusEvents = [], consumptions = [] } = {},
) {
  const cashierDisplay = order.cashier_name || order.creator_display_name || "Staff";
  const mapped = {
    id: order.order_number,
    customer: order.customer_name,
    cashier: cashierDisplay,
    createdById: order.created_by == null ? null : Number(order.created_by),
    createdBy: cashierDisplay,
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
    items: orderItemsList.map((item) => {
      const snapshotVal = item.unit_cost_snapshot == null ? null : Number(item.unit_cost_snapshot);
      const itemAddons = addonsByItemId.get(Number(item.id)) || [];
      return {
        id: Number(item.id),
        productId: item.product_id == null ? null : Number(item.product_id),
        title: item.product_name_snapshot || item.current_product_name,
        quantity: Number(item.quantity),
        price: Number(item.unit_price),
        ...(includeCost ? {
          unitCost: snapshotVal,
          ...(includeDetails ? { unitCostSnapshot: snapshotVal } : {}),
        } : {}),
        size: item.size_label,
        category: item.category_name_snapshot || "Menu item",
        sugarLevel: item.sugar_level,
        addons: itemAddons.map((addon) => addon.addon_name_snapshot),
        instructions: item.instructions,
        notes: item.instructions,
      };
    }),
    subtotal: Number(order.subtotal ?? order.total),
    discountAmount: Number(order.discount_amount ?? 0),
    discountLabel: order.discount_label || null,
    taxAmount: Number(order.tax_amount ?? 0),
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
  };

  if (includeDetails) {
    mapped.statusEvents = statusEvents.map((event) => ({
      id: Number(event.id),
      orderId: Number(event.order_id),
      fromStatus: event.from_status || null,
      toStatus: event.to_status,
      changedBy: event.changed_by == null ? null : Number(event.changed_by),
      actorName: event.actor_name_snapshot || event.actor_display_name || "System",
      reason: event.reason || null,
      createdAt: new Date(event.created_at).toISOString(),
    }));
    mapped.ingredientsUsed = consumptions.map((c) => ({
      id: Number(c.id),
      orderItemId: c.order_item_id == null ? null : Number(c.order_item_id),
      inventoryItemId: Number(c.inventory_item_id),
      inventoryName: c.current_item_name || c.inventory_item_name_snapshot,
      productName: c.product_name_snapshot,
      quantityUsed: Number(c.quantity_used),
      unit: c.unit,
      source: c.source || "recipe",
      reversedAt: c.reversed_at ? new Date(c.reversed_at).toISOString() : null,
    }));
    if (includeCost) {
      mapped.consumptions = consumptions.map((c) => {
        const name = c.current_item_name || c.inventory_item_name_snapshot;
        const lineCost = Number(c.line_cost || 0);
        return {
          id: Number(c.id),
          orderItemId: c.order_item_id == null ? null : Number(c.order_item_id),
          inventoryItemId: Number(c.inventory_item_id),
          inventoryName: name,
          itemName: name,
          productName: c.product_name_snapshot,
          quantity: Number(c.quantity_used),
          quantityUsed: Number(c.quantity_used),
          unit: c.unit,
          unitCostSnapshot: Number(c.unit_cost_snapshot || 0),
          lineCost,
          totalCost: lineCost,
          source: c.source || "recipe",
          reversedAt: c.reversed_at ? new Date(c.reversed_at).toISOString() : null,
        };
      });
    }
  }
  return mapped;
}

export async function loadOrders(limit = 500, { includeCost = false, statuses = null } = {}) {
  const safeLimit = limit == null ? null : Math.min(Math.max(1, Number(limit || 500)), 5000);
  const conditions = [];
  const params = [];
  if (Array.isArray(statuses) && statuses.length > 0) {
    conditions.push(`orders.order_status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitSql = safeLimit != null ? "LIMIT ?" : "";
  if (safeLimit != null) params.push(safeLimit);

  const [orders] = await pool.query(
    `${ORDER_WITH_ACTORS_SELECT} ${whereSql} ORDER BY orders.created_at DESC, orders.id DESC ${limitSql}`,
    params,
  );
  if (!orders.length) return [];
  const ids = orders.map((order) => order.id);
  const marks = ids.map(() => "?").join(",");
  const [itemResult, addonResult] = await Promise.all([
    pool.execute("SELECT oi.*, p.name AS current_product_name FROM order_items oi LEFT JOIN menu_products p ON p.id = oi.product_id WHERE oi.order_id IN (" + marks + ") ORDER BY oi.id", ids),
    pool.execute("SELECT oia.*, oi.order_id FROM order_item_addons oia JOIN order_items oi ON oi.id = oia.order_item_id WHERE oi.order_id IN (" + marks + ") ORDER BY oia.id", ids),
  ]);
  const itemsByOrderId = groupRowsByKey(itemResult[0], "order_id");
  const addonsByItemId = groupRowsByKey(addonResult[0], "order_item_id");
  return orders.map((order) =>
    mapOrderRecord(order, itemsByOrderId.get(Number(order.id)) || [], addonsByItemId, { includeCost }),
  );
}

export async function loadOrderByNumber(orderNumber, { includeCost = false, includeDetails = false } = {}) {
  const [orders] = await pool.execute(
    `${ORDER_WITH_ACTORS_SELECT} WHERE orders.order_number = ? LIMIT 1`,
    [orderNumber],
  );
  const order = orders[0];
  if (!order) return null;
  const queries = [
    pool.execute("SELECT oi.*, p.name AS current_product_name FROM order_items oi LEFT JOIN menu_products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id", [order.id]),
    pool.execute("SELECT oia.*, oi.order_id FROM order_item_addons oia JOIN order_items oi ON oi.id = oia.order_item_id WHERE oi.order_id = ? ORDER BY oia.id", [order.id]),
  ];
  if (includeDetails) {
    queries.push(
      pool.execute(
        `SELECT e.*, COALESCE(NULLIF(u.display_name, ''), u.username) AS actor_display_name
           FROM order_status_events e
           LEFT JOIN users u ON u.id = e.changed_by
          WHERE e.order_id = ?
          ORDER BY e.created_at ASC, e.id ASC`,
        [order.id],
      ),
    );
    const consumptionSelect = includeCost
      ? "c.*, ii.name AS current_item_name"
      : "c.id, c.order_item_id, c.inventory_item_id, c.product_name_snapshot, c.inventory_item_name_snapshot, c.quantity_used, c.unit, c.source, c.reversed_at, ii.name AS current_item_name";
    queries.push(
      pool.execute(
        `SELECT ${consumptionSelect}
           FROM order_inventory_consumptions c
           LEFT JOIN inventory_items ii ON ii.id = c.inventory_item_id
          WHERE c.order_id = ?
          ORDER BY c.order_item_id ASC, c.source ASC, c.id ASC`,
        [order.id],
      ),
    );
  }
  const results = await Promise.all(queries);
  const items = results[0][0];
  const addons = results[1][0];
  const statusEvents = includeDetails ? results[2][0] : [];
  const consumptions = includeDetails ? results[3][0] : [];
  const addonsByItemId = groupRowsByKey(addons, "order_item_id");
  return mapOrderRecord(order, items, addonsByItemId, { includeCost, includeDetails, statusEvents, consumptions });
}

export async function findUnusedOrderNumber(connection) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const datePart = formatManilaOrderStamp();
    const value = `AM-${datePart}-${String(randomInt(0, 1000000)).padStart(6, "0")}`;
    const [rows] = await connection.execute("SELECT id FROM orders WHERE order_number = ?", [value]);
    if (!rows.length) return value;
  }
  throw httpError(503, "Could not allocate an order number. Please try again.");
}

export async function loadOrderSummary() {
  const { start: todayStart, end: todayEnd } = getManilaTodayBounds();
  const [salesRows] = await pool.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' THEN total ELSE 0 END), 0) AS all_time_sales,
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND created_at BETWEEN ? AND ? THEN total ELSE 0 END), 0) AS today_sales,
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' THEN 1 ELSE 0 END), 0) AS all_time_paid_orders,
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS today_paid_orders,
       COALESCE(SUM(CASE WHEN order_status = 'Pending' THEN 1 ELSE 0 END), 0) AS pending_orders,
       COALESCE(SUM(CASE WHEN order_status = 'Cancelled' THEN 1 ELSE 0 END), 0) AS all_time_voided_orders,
       COALESCE(SUM(CASE WHEN order_status = 'Cancelled' AND created_at BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS today_voided_orders,
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND payment_method = 'Cash' AND created_at BETWEEN ? AND ? THEN total ELSE 0 END), 0) AS today_cash_collected,
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND payment_method = 'Cash' THEN total ELSE 0 END), 0) AS all_time_cash_collected
     FROM orders`,
    [todayStart, todayEnd, todayStart, todayEnd, todayStart, todayEnd, todayStart, todayEnd],
  );
  const [itemRows] = await pool.execute(
    `SELECT
       COALESCE(SUM(oi.quantity), 0) AS all_time_units_sold,
       COALESCE(SUM(CASE WHEN o.created_at BETWEEN ? AND ? THEN oi.quantity ELSE 0 END), 0) AS today_units_sold,
       COALESCE(SUM(
         COALESCE(
           NULLIF(oic_sum.consumption_cost, 0),
           oi.quantity * COALESCE(NULLIF(oi.unit_cost_snapshot, 0), NULLIF(mp.cost_price, 0), 0)
         )
       ), 0) AS all_time_cogs,
       COALESCE(SUM(
         CASE WHEN o.created_at BETWEEN ? AND ? THEN
           COALESCE(
             NULLIF(oic_sum.consumption_cost, 0),
             oi.quantity * COALESCE(NULLIF(oi.unit_cost_snapshot, 0), NULLIF(mp.cost_price, 0), 0)
           )
         ELSE 0 END
       ), 0) AS today_cogs
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN menu_products mp ON mp.id = oi.product_id
     LEFT JOIN (
       SELECT order_item_id, SUM(line_cost) AS consumption_cost
         FROM order_inventory_consumptions
        WHERE order_item_id IS NOT NULL AND reversed_at IS NULL
        GROUP BY order_item_id
     ) oic_sum ON oic_sum.order_item_id = oi.id
     WHERE o.payment_status = 'Paid' AND o.order_status <> 'Cancelled'`,
    [todayStart, todayEnd, todayStart, todayEnd],
  );
  const s = salesRows[0] || {};
  const it = itemRows[0] || {};
  const allTimeSales = Number(Number(s.all_time_sales || 0).toFixed(2));
  const todaySales = Number(Number(s.today_sales || 0).toFixed(2));
  const allTimeCogs = Number(Number(it.all_time_cogs || 0).toFixed(2));
  const todayCogs = Number(Number(it.today_cogs || 0).toFixed(2));

  return {
    allTimeSales,
    todaySales,
    allTimeCogs,
    todayCogs,
    allTimeGrossProfit: Number((allTimeSales - allTimeCogs).toFixed(2)),
    todayGrossProfit: Number((todaySales - todayCogs).toFixed(2)),
    allTimePaidOrders: Number(s.all_time_paid_orders || 0),
    todayPaidOrders: Number(s.today_paid_orders || 0),
    allTimeVoidedOrders: Number(s.all_time_voided_orders || 0),
    todayVoidedOrders: Number(s.today_voided_orders || 0),
    allTimeUnitsSold: Number(it.all_time_units_sold || 0),
    todayUnitsSold: Number(it.today_units_sold || 0),
    pendingOrders: Number(s.pending_orders || 0),
    todayCashCollected: Number(Number(s.today_cash_collected || 0).toFixed(2)),
    allTimeCashCollected: Number(Number(s.all_time_cash_collected || 0).toFixed(2)),
  };
}
