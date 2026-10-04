import { randomInt } from "node:crypto";
import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const orderFlow = ["Pending", "Preparing", "Ready", "Completed"];
const paymentMethods = ["Cash", "GCash", "Card"];
const orderTypes = ["Counter", "Takeout", "Dine-in"];

async function loadOrders() {
  const [orders] = await pool.execute("SELECT * FROM orders ORDER BY created_at DESC, id DESC");
  if (!orders.length) return [];
  const ids = orders.map((order) => order.id);
  const marks = ids.map(() => "?").join(",");
  const [itemResult, addonResult] = await Promise.all([
    pool.execute("SELECT oi.*, p.name AS current_product_name FROM order_items oi LEFT JOIN menu_products p ON p.id = oi.product_id WHERE oi.order_id IN (" + marks + ") ORDER BY oi.id", ids),
    pool.execute("SELECT oia.*, oi.order_id FROM order_item_addons oia JOIN order_items oi ON oi.id = oia.order_item_id WHERE oi.order_id IN (" + marks + ") ORDER BY oia.id", ids),
  ]);
  const items = itemResult[0];
  const addons = addonResult[0];
  return orders.map((order) => ({
    id: order.order_number,
    customer: order.customer_name,
    items: items.filter((item) => Number(item.order_id) === Number(order.id)).map((item) => ({
      productId: item.product_id == null ? null : Number(item.product_id),
      title: item.product_name_snapshot || item.current_product_name,
      quantity: Number(item.quantity),
      price: Number(item.unit_price),
      size: item.size_label,
      category: item.category_name_snapshot || "Menu item",
      sugarLevel: item.sugar_level,
      addons: addons.filter((addon) => Number(addon.order_item_id) === Number(item.id)).map((addon) => addon.addon_name_snapshot),
      instructions: item.instructions,
    })),
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
    createdAt: new Date(order.created_at).toISOString(),
  }));
}

async function findUnusedOrderNumber(connection) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const datePart = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
    const value = `AM-${datePart}-${String(randomInt(0, 1000000)).padStart(6, "0")}`;
    const [rows] = await connection.execute("SELECT id FROM orders WHERE order_number = ?", [value]);
    if (!rows.length) return value;
  }
  throw httpError(503, "Could not allocate an order number. Please try again.");
}

router.get("/", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  response.json(await loadOrders());
});

router.post("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const items = Array.isArray(request.body?.items) ? request.body.items : [];
  if (!items.length || items.length > 100) throw httpError(400, "An order must contain between 1 and 100 items.");
  const type = orderTypes.includes(request.body.type) ? request.body.type : "Takeout";
  const paymentMethod = paymentMethods.includes(request.body.paymentMethod) ? request.body.paymentMethod : "Cash";
  const customer = String(request.body.customerName || "Walk-in Customer").trim().slice(0, 160) || "Walk-in Customer";
  const connection = await pool.getConnection();
  let orderNumber;
  try {
    await connection.beginTransaction();
    orderNumber = await findUnusedOrderNumber(connection);
    const lineItems = [];
    let total = 0;

    for (const item of items) {
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000) {
        throw httpError(400, "Each order item needs a valid menu item and quantity.");
      }
      const [[product]] = await connection.execute(
        `SELECT p.id, p.name, p.base_price, p.stock_quantity, p.is_available, c.name AS category
           FROM menu_products p LEFT JOIN menu_categories c ON c.id = p.category_id WHERE p.id = ? FOR UPDATE`, [productId],
      );
      if (!product || !product.is_available) throw httpError(409, "A selected menu item is unavailable.");
      if (Number(product.stock_quantity) < quantity) throw httpError(409, `${product.name} does not have enough stock for this order.`);

      const sizeLabel = String(item.size || "Regular").trim().slice(0, 80);
      const [[size]] = await connection.execute("SELECT price FROM product_sizes WHERE product_id = ? AND label = ?", [productId, sizeLabel]);
      if (!size) throw httpError(400, `The selected size for ${product.name} is no longer available.`);
      const addonNames = Array.isArray(item.addons) ? [...new Set(item.addons.map((addon) => String(addon).trim()).filter(Boolean))] : [];
      const addonPrices = [];
      for (const addonName of addonNames) {
        const [[addon]] = await connection.execute("SELECT label, price FROM product_addons WHERE product_id = ? AND label = ?", [productId, addonName]);
        if (!addon) throw httpError(400, `An add-on for ${product.name} is no longer available.`);
        addonPrices.push({ label: addon.label, price: Number(addon.price) });
      }
      const unitPrice = Number((Number(size.price) + addonPrices.reduce((sum, addon) => sum + addon.price, 0)).toFixed(2));
      total = Math.round((total + unitPrice * quantity) * 100) / 100;
      lineItems.push({ product, quantity, sizeLabel, unitPrice, addonPrices, sugarLevel: String(item.sugarLevel || "").slice(0, 40) || null, instructions: String(item.instructions || "").slice(0, 500) || null });
    }

    const tendered = paymentMethod === "Cash" ? Number(request.body.cashTendered ?? total) : null;
    if (tendered != null && (!Number.isFinite(tendered) || tendered < total)) throw httpError(400, "Cash tendered must cover the order total.");
    const change = tendered == null ? null : Math.round((tendered - total) * 100) / 100;
    const [created] = await connection.execute(
      `INSERT INTO orders (order_number, customer_name, order_type, order_status, payment_status, payment_method, subtotal, total, cash_tendered, change_due, paid_at, created_by)
       VALUES (?, ?, ?, 'Pending', 'Paid', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [orderNumber, customer, type, paymentMethod, total, total, tendered, change, request.authUser.sub],
    );

    for (const line of lineItems) {
      const [stockResult] = await connection.execute(
        "UPDATE menu_products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?",
        [line.quantity, line.product.id, line.quantity],
      );
      if (!stockResult.affectedRows) throw httpError(409, `${line.product.name} stock changed while the order was being placed. Please try again.`);
      const [createdItem] = await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, sugar_level, unit_price, instructions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, line.product.id, line.product.name, line.product.category || "Menu item", line.quantity, line.sizeLabel, line.sugarLevel, line.unitPrice, line.instructions],
      );
      for (const addon of line.addonPrices) {
        await connection.execute("INSERT INTO order_item_addons (order_item_id, addon_name_snapshot, addon_price_snapshot) VALUES (?, ?, ?)", [createdItem.insertId, addon.label, addon.price]);
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  response.status(201).json((await loadOrders()).find((order) => order.id === orderNumber));
});

router.patch("/:orderNumber/status", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const [rows] = await pool.execute("SELECT id, order_status FROM orders WHERE order_number = ?", [request.params.orderNumber]);
  const order = rows[0];
  if (!order) throw httpError(404, "Order not found.");
  const current = orderFlow.indexOf(order.order_status);
  if (current < 0 || request.body?.status !== orderFlow[current + 1]) throw httpError(409, "Orders can only advance one step at a time.");
  const [updatedRows] = await pool.execute("UPDATE orders SET order_status = ? WHERE id = ? AND order_status = ?", [request.body.status, order.id, order.order_status]);
  if (!updatedRows.affectedRows) throw httpError(409, "This order was updated elsewhere. Refresh and try again.");
  response.json((await loadOrders()).find((entry) => entry.id === request.params.orderNumber));
});

router.patch("/:orderNumber/confirm", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const [rows] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [request.params.orderNumber]);
  if (!rows.length) throw httpError(404, "Order not found.");
  await pool.execute("UPDATE orders SET confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP) WHERE id = ?", [rows[0].id]);
  response.json((await loadOrders()).find((entry) => entry.id === request.params.orderNumber));
});

router.patch("/:orderNumber/payment", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const method = paymentMethods.includes(request.body?.paymentMethod) ? request.body.paymentMethod : undefined;
  const [rows] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [request.params.orderNumber]);
  if (!rows.length) throw httpError(404, "Order not found.");
  await pool.execute(
    `UPDATE orders SET payment_status = 'Paid', payment_method = COALESCE(?, payment_method), paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ?`,
    [method || null, rows[0].id],
  );
  response.json((await loadOrders()).find((entry) => entry.id === request.params.orderNumber));
});

router.delete("/:orderNumber", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.execute("SELECT id, order_status FROM orders WHERE order_number = ? FOR UPDATE", [request.params.orderNumber]);
    if (!order) throw httpError(404, "Order not found.");
    const [items] = await connection.execute("SELECT product_id, SUM(quantity) AS quantity FROM order_items WHERE order_id = ? GROUP BY product_id", [order.id]);
    if (order.order_status !== "Completed") {
      for (const item of items) {
        if (item.product_id != null) await connection.execute("UPDATE menu_products SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.product_id]);
      }
    }
    await connection.execute("DELETE FROM orders WHERE id = ?", [order.id]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
  response.status(204).end();
});

export default router;
