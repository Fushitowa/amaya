import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

function isValidIsoDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function mapSessionRow(row) {
  const openingFloat = Number(row.opening_float || 0);
  const cashSales = Number(row.cash_sales || 0);
  const liveExpectedCash = Number((openingFloat + cashSales).toFixed(2));
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    cashierName: row.cashier_display_name || row.cashier_name_snapshot,
    cashierNameSnapshot: row.cashier_name_snapshot,
    terminalLabel: row.terminal_label,
    openedAt: new Date(row.opened_at).toISOString(),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    status: row.status,
    openingFloat,
    expectedCash: row.expected_cash != null ? Number(row.expected_cash) : liveExpectedCash,
    countedCash: row.counted_cash == null ? null : Number(row.counted_cash),
    variance: row.variance == null ? null : Number(row.variance),
    closingNotes: row.closing_notes || "",
    closedBy: row.closed_by == null ? null : Number(row.closed_by),
    closedByName: row.closed_by_name || null,
    ordersCount: Number(row.orders_count || 0),
    paidOrdersCount: Number(row.paid_orders_count || 0),
    voidedOrdersCount: Number(row.voided_orders_count || 0),
    paidSales: Number(Number(row.paid_sales || 0).toFixed(2)),
    cashSales: Number(cashSales.toFixed(2)),
    gcashSales: Number(Number(row.gcash_sales || 0).toFixed(2)),
    cardSales: Number(Number(row.card_sales || 0).toFixed(2)),
    movementsCount: Number(row.movements_count || 0),
  };
}

const SESSION_AGGREGATE_SQL = `
  SELECT cs.*,
         NULLIF(u.display_name, '') AS cashier_display_name,
         COALESCE(NULLIF(uc.display_name, ''), uc.username) AS closed_by_name,
         COALESCE(os.orders_count, 0) AS orders_count,
         COALESCE(os.paid_orders_count, 0) AS paid_orders_count,
         COALESCE(os.voided_orders_count, 0) AS voided_orders_count,
         COALESCE(os.paid_sales, 0) AS paid_sales,
         COALESCE(os.cash_sales, 0) AS cash_sales,
         COALESCE(os.gcash_sales, 0) AS gcash_sales,
         COALESCE(os.card_sales, 0) AS card_sales,
         COALESCE(ms.movements_count, 0) AS movements_count
    FROM cashier_sessions cs
    LEFT JOIN users u ON u.id = cs.user_id
    LEFT JOIN users uc ON uc.id = cs.closed_by
    LEFT JOIN (
      SELECT session_id,
             COUNT(*) AS orders_count,
             SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' THEN 1 ELSE 0 END) AS paid_orders_count,
             SUM(CASE WHEN order_status = 'Cancelled' THEN 1 ELSE 0 END) AS voided_orders_count,
             COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' THEN total ELSE 0 END), 0) AS paid_sales,
             COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND payment_method = 'Cash' THEN total ELSE 0 END), 0) AS cash_sales,
             COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND payment_method = 'GCash' THEN total ELSE 0 END), 0) AS gcash_sales,
             COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND payment_method = 'Card' THEN total ELSE 0 END), 0) AS card_sales
        FROM orders
       WHERE session_id IS NOT NULL
       GROUP BY session_id
    ) os ON os.session_id = cs.id
    LEFT JOIN (
      SELECT session_id, COUNT(*) AS movements_count
        FROM inventory_movements
       WHERE session_id IS NOT NULL
       GROUP BY session_id
    ) ms ON ms.session_id = cs.id
`;

async function fetchSessionById(sessionId) {
  const [[row]] = await pool.execute(`${SESSION_AGGREGATE_SQL} WHERE cs.id = ? LIMIT 1`, [sessionId]);
  return row ? mapSessionRow(row) : null;
}

router.get("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const { userId, status, from, to } = request.query || {};
  const isAdmin = request.authUser.role === "admin";
  const conditions = [];
  const params = [];

  if (!isAdmin) {
    if (userId !== undefined && userId !== "" && Number(userId) !== Number(request.authUser.sub)) {
      throw httpError(403, "You can only view your own register sessions.");
    }
    conditions.push("cs.user_id = ?");
    params.push(request.authUser.sub);
  } else if (userId !== undefined && userId !== "") {
    const parsedUserId = Number(userId);
    if (!Number.isSafeInteger(parsedUserId) || parsedUserId <= 0) throw httpError(400, "Invalid userId filter.");
    conditions.push("cs.user_id = ?");
    params.push(parsedUserId);
  }

  if (status !== undefined && status !== "") {
    const cleanStatus = String(status).trim().toLowerCase();
    if (!["open", "closed"].includes(cleanStatus)) throw httpError(400, "Status must be 'open' or 'closed'.");
    conditions.push("cs.status = ?");
    params.push(cleanStatus);
  }
  if (from !== undefined && from !== "") {
    if (!isValidIsoDateOnly(from)) throw httpError(400, "Invalid 'from' date. Expected YYYY-MM-DD.");
    conditions.push("cs.opened_at >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to !== undefined && to !== "") {
    if (!isValidIsoDateOnly(to)) throw httpError(400, "Invalid 'to' date. Expected YYYY-MM-DD.");
    conditions.push("cs.opened_at <= ?");
    params.push(`${to} 23:59:59`);
  }
  if (from && to && String(from) > String(to)) {
    throw httpError(400, "Start date must be on or before end date.");
  }

  const page = Math.max(1, Number.parseInt(request.query?.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query?.limit, 10) || 25));
  const offset = (page - 1) * limit;
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM cashier_sessions cs ${whereClause}`,
    params,
  );
  const [rows] = await pool.query(
    `${SESSION_AGGREGATE_SQL} ${whereClause} ORDER BY cs.opened_at DESC, cs.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  response.json({
    items: rows.map(mapSessionRow),
    total: Number(countRow?.total || 0),
    page,
    limit,
  });
});

router.get("/current", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const [[row]] = await pool.execute(
    `${SESSION_AGGREGATE_SQL}
      WHERE cs.user_id = ? AND cs.status = 'open'
      ORDER BY cs.opened_at DESC, cs.id DESC
      LIMIT 1`,
    [request.authUser.sub],
  );
  response.json({ session: row ? mapSessionRow(row) : null });
});

router.post("/open", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const rawFloat = request.body?.openingFloat ?? 0;
  const openingFloat = rawFloat === "" || rawFloat == null ? 0 : Number(rawFloat);
  if (!Number.isFinite(openingFloat) || openingFloat < 0 || openingFloat > 10_000_000) {
    throw httpError(400, "Opening float must be a non-negative amount.");
  }
  const terminalLabel = String(request.body?.terminalLabel || "Counter 1").trim().slice(0, 80) || "Counter 1";
  const cashierNameSnapshot = String(request.authUser?.displayName || request.authUser?.username || "Staff").slice(0, 100);

  const connection = await pool.getConnection();
  let sessionId;
  try {
    await connection.beginTransaction();
    const [[existingOpen]] = await connection.execute(
      "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' LIMIT 1 FOR UPDATE",
      [request.authUser.sub],
    );
    if (existingOpen) {
      throw httpError(409, "You already have an open register session. Close it before opening a new one.");
    }
    const [result] = await connection.execute(
      `INSERT INTO cashier_sessions (user_id, cashier_name_snapshot, terminal_label, opening_float, status)
       VALUES (?, ?, ?, ?, 'open')`,
      [request.authUser.sub, cashierNameSnapshot, terminalLabel, Number(openingFloat.toFixed(2))],
    );
    sessionId = result.insertId;
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  response.status(201).json({ session: await fetchSessionById(sessionId) });
});

router.post("/:id/close", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const sessionId = Number(request.params.id);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw httpError(400, "Invalid session ID.");

  const rawCounted = request.body?.countedCash;
  if (rawCounted === undefined || rawCounted === null || String(rawCounted).trim() === "") {
    throw httpError(400, "Counted drawer cash is required to close a shift.");
  }
  const countedCash = Number(rawCounted);
  if (!Number.isFinite(countedCash) || countedCash < 0 || countedCash > 10_000_000) {
    throw httpError(400, "Counted cash must be a non-negative amount.");
  }
  const closingNotes = String(request.body?.closingNotes || "").trim().slice(0, 500) || null;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[session]] = await connection.execute(
      "SELECT * FROM cashier_sessions WHERE id = ? FOR UPDATE",
      [sessionId],
    );
    if (!session) throw httpError(404, "Register session not found.");
    if (request.authUser.role !== "admin" && Number(session.user_id) !== Number(request.authUser.sub)) {
      throw httpError(403, "You do not have permission to close this register session.");
    }
    if (session.status !== "open") {
      throw httpError(409, "This register session is already closed.");
    }

    const [[cashRow]] = await connection.execute(
      `SELECT COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND order_status <> 'Cancelled' AND payment_method = 'Cash' THEN total ELSE 0 END), 0) AS cash_sales
         FROM orders
        WHERE session_id = ?`,
      [sessionId],
    );
    const expectedCash = Number((Number(session.opening_float || 0) + Number(cashRow?.cash_sales || 0)).toFixed(2));
    const roundedCounted = Number(countedCash.toFixed(2));
    const variance = Number((roundedCounted - expectedCash).toFixed(2));

    await connection.execute(
      `UPDATE cashier_sessions
          SET status = 'closed',
              closed_at = CURRENT_TIMESTAMP,
              expected_cash = ?,
              counted_cash = ?,
              variance = ?,
              closing_notes = ?,
              closed_by = ?
        WHERE id = ?`,
      [expectedCash, roundedCounted, variance, closingNotes, request.authUser.sub, sessionId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  response.json({ session: await fetchSessionById(sessionId) });
});

router.get("/:id", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const sessionId = Number(request.params.id);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw httpError(400, "Invalid session ID.");

  const session = await fetchSessionById(sessionId);
  if (!session) throw httpError(404, "Register session not found.");
  if (request.authUser.role !== "admin" && Number(session.userId) !== Number(request.authUser.sub)) {
    throw httpError(403, "You do not have permission to view this register session.");
  }

  const isAdmin = request.authUser.role === "admin";
  const [orders] = await pool.execute(
    `SELECT o.*, NULLIF(u.display_name, '') AS creator_display_name
       FROM orders o
       LEFT JOIN users u ON u.id = o.created_by
      WHERE o.session_id = ?
      ORDER BY o.created_at DESC, o.id DESC`,
    [sessionId],
  );

  let orderItems = [];
  let orderAddons = [];
  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id);
    const marks = orderIds.map(() => "?").join(",");
    const [itemRes, addonRes] = await Promise.all([
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
    orderItems = itemRes[0];
    orderAddons = addonRes[0];
  }

  const mappedOrders = orders.map((order) => ({
    id: order.order_number,
    customer: order.customer_name,
    cashier: order.cashier_name || order.creator_display_name || "Staff",
    createdById: order.created_by == null ? null : Number(order.created_by),
    total: Number(order.total),
    status: order.order_status,
    type: order.order_type,
    payment: order.payment_status,
    paymentMethod: order.payment_method,
    paidAt: order.paid_at ? new Date(order.paid_at).toISOString() : null,
    cashTendered: order.cash_tendered == null ? null : Number(order.cash_tendered),
    changeDue: order.change_due == null ? null : Number(order.change_due),
    voidReason: order.void_reason || null,
    voidedAt: order.voided_at ? new Date(order.voided_at).toISOString() : null,
    notes: order.notes || null,
    createdAt: new Date(order.created_at).toISOString(),
    items: orderItems
      .filter((item) => Number(item.order_id) === Number(order.id))
      .map((item) => ({
        id: Number(item.id),
        productId: item.product_id == null ? null : Number(item.product_id),
        title: item.product_name_snapshot || item.current_product_name,
        quantity: Number(item.quantity),
        price: Number(item.unit_price),
        ...(isAdmin ? { unitCost: item.unit_cost_snapshot == null ? null : Number(item.unit_cost_snapshot) } : {}),
        size: item.size_label,
        category: item.category_name_snapshot || "Menu item",
        sugarLevel: item.sugar_level,
        addons: orderAddons
          .filter((addon) => Number(addon.order_item_id) === Number(item.id))
          .map((addon) => addon.addon_name_snapshot),
        instructions: item.instructions,
      })),
  }));

  const [productRows] = await pool.execute(
    `SELECT oi.product_id,
            oi.product_name_snapshot,
            oi.size_label,
            COALESCE(SUM(oi.quantity), 0) AS units_sold,
            COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS sales,
            COALESCE(SUM(
              COALESCE(
                NULLIF(oic_sum.consumption_cost, 0),
                oi.quantity * COALESCE(NULLIF(oi.unit_cost_snapshot, 0), NULLIF(mp.cost_price, 0), 0)
              )
            ), 0) AS cogs
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN menu_products mp ON mp.id = oi.product_id
       LEFT JOIN (
         SELECT order_item_id, SUM(line_cost) AS consumption_cost
           FROM order_inventory_consumptions
          WHERE order_item_id IS NOT NULL AND reversed_at IS NULL
          GROUP BY order_item_id
       ) oic_sum ON oic_sum.order_item_id = oi.id
      WHERE o.session_id = ?
        AND o.payment_status = 'Paid'
        AND o.order_status <> 'Cancelled'
      GROUP BY oi.product_id, oi.product_name_snapshot, oi.size_label
      ORDER BY sales DESC, units_sold DESC`,
    [sessionId],
  );

  const productBreakdown = productRows.map((row) => {
    const sales = Number(Number(row.sales || 0).toFixed(2));
    const cogs = Number(Number(row.cogs || 0).toFixed(2));
    return {
      productId: row.product_id == null ? null : Number(row.product_id),
      productName: row.product_name_snapshot,
      sizeLabel: row.size_label || "Regular",
      unitsSold: Number(row.units_sold || 0),
      sales,
      ...(isAdmin ? {
        cogs,
        grossProfit: Number((sales - cogs).toFixed(2)),
      } : {}),
    };
  });

  const [paymentRows] = await pool.execute(
    `SELECT COALESCE(payment_method, 'Cash') AS method,
            COUNT(*) AS orders_count,
            COALESCE(SUM(total), 0) AS sales
       FROM orders
      WHERE session_id = ?
        AND payment_status = 'Paid'
        AND order_status <> 'Cancelled'
      GROUP BY COALESCE(payment_method, 'Cash')`,
    [sessionId],
  );
  const paymentBreakdown = paymentRows.map((row) => ({
    method: row.method,
    ordersCount: Number(row.orders_count || 0),
    sales: Number(Number(row.sales || 0).toFixed(2)),
  }));

  const [movementRows] = await pool.execute(
    `SELECT m.*,
            COALESCE(ii.name, m.item_name_snapshot) AS item_name,
            ii.unit AS current_item_unit,
            COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name,
            o.order_number
       FROM inventory_movements m
       LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN orders o ON o.id = m.order_id
      WHERE m.session_id = ?
      ORDER BY m.created_at DESC, m.id DESC`,
    [sessionId],
  );
  const movements = movementRows.map((row) => ({
    id: Number(row.id),
    itemId: Number(row.inventory_item_id),
    itemName: row.item_name || row.item_name_snapshot || "Unknown Item",
    type: row.movement_type,
    quantityChange: Number(row.quantity_change),
    beforeQuantity: row.before_quantity == null ? null : Number(row.before_quantity),
    afterQuantity: row.after_quantity == null ? null : Number(row.after_quantity),
    unit: row.unit || row.current_item_unit || null,
    ...(isAdmin ? {
      batchCost: row.batch_cost == null ? null : Number(row.batch_cost),
      unitCostBefore: row.unit_cost_before == null ? null : Number(row.unit_cost_before),
      unitCostAfter: row.unit_cost_after == null ? null : Number(row.unit_cost_after),
    } : {}),
    supplierName: row.supplier_name || null,
    referenceNo: row.reference_no || null,
    orderId: row.order_id == null ? null : Number(row.order_id),
    orderNumber: row.order_number || null,
    note: row.note || "",
    actor: row.actor_name || "System",
    timestamp: new Date(row.created_at).toISOString(),
  }));

  response.json({
    session,
    orders: mappedOrders,
    productBreakdown,
    paymentBreakdown,
    movements,
  });
});

export default router;
