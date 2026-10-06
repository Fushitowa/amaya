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
        const [[addon]] = await connection.execute(
          `SELECT pa.label, pa.price, pa.inventory_item_id, pa.quantity_used,
                  i.name AS inventory_name, i.unit AS inventory_unit
             FROM product_addons pa LEFT JOIN inventory_items i ON i.id = pa.inventory_item_id
            WHERE pa.product_id = ? AND pa.label = ?`, [productId, addonName],
        );
        if (!addon) throw httpError(400, `An add-on for ${product.name} is no longer available.`);
        if (!addon.inventory_item_id || !Number.isFinite(Number(addon.quantity_used)) || Number(addon.quantity_used) <= 0 || !addon.inventory_unit) {
          throw httpError(409, `${addon.label} needs Inventory setup. Ask an admin to edit and save ${product.name} in Menu Management first.`);
        }
        addonPrices.push({
          label: addon.label,
          price: Number(addon.price),
          inventoryItemId: Number(addon.inventory_item_id),
          inventoryName: addon.inventory_name,
          unit: addon.inventory_unit,
          quantityPerServing: Number(addon.quantity_used),
        });
      }
      const unitPrice = Number((Number(size.price) + addonPrices.reduce((sum, addon) => sum + addon.price, 0)).toFixed(2));
      total = Math.round((total + unitPrice * quantity) * 100) / 100;
      lineItems.push({ product, quantity, sizeLabel, unitPrice, addonPrices, sugarLevel: String(item.sugarLevel || "").slice(0, 40) || null, instructions: String(item.instructions || "").slice(0, 500) || null });
    }

    const productIds = [...new Set(lineItems.map((line) => Number(line.product.id)))];
    const productMarks = productIds.map(() => "?").join(",");
    const [recipeRows] = await connection.execute(
      `SELECT pi.product_id, pi.inventory_item_id, pi.quantity_used, pi.unit AS recipe_unit,
              i.name AS inventory_name, i.unit AS inventory_unit, i.quantity AS inventory_quantity
         FROM product_ingredients pi
         JOIN inventory_items i ON i.id = pi.inventory_item_id
        WHERE pi.product_id IN (${productMarks})
        ORDER BY pi.inventory_item_id, pi.product_id`,
      productIds,
    );
    const recipesByProduct = new Map();
    const inventoryNeeds = new Map();
    recipeRows.forEach((ingredient) => {
      const productId = Number(ingredient.product_id);
      const inventoryItemId = Number(ingredient.inventory_item_id);
      const quantityPerServing = Number(ingredient.quantity_used);
      const recipeUnit = String(ingredient.recipe_unit || "").trim();
      const inventoryUnit = String(ingredient.inventory_unit || "").trim();
      if (!Number.isFinite(quantityPerServing) || quantityPerServing <= 0 || !recipeUnit
        || recipeUnit.toLowerCase() !== inventoryUnit.toLowerCase()) {
        throw httpError(409, `The recipe for ${lineItems.find((line) => Number(line.product.id) === productId)?.product.name || "a menu item"} is incomplete or uses a different unit than Inventory. Update its recipe before ordering.`);
      }
      const amount = Math.round(quantityPerServing * 1000) / 1000;
      const entries = recipesByProduct.get(productId) || [];
      entries.push({
        inventoryItemId,
        inventoryName: ingredient.inventory_name,
        unit: inventoryUnit,
        quantityPerServing: amount,
      });
      recipesByProduct.set(productId, entries);
      inventoryNeeds.set(inventoryItemId, {
        inventoryName: ingredient.inventory_name,
        unit: inventoryUnit,
        required: 0,
      });
    });

    for (const line of lineItems) {
      const perItem = new Map();
      const addUsage = (usage) => {
        const inventoryItemId = Number(usage.inventoryItemId);
        const current = perItem.get(inventoryItemId) || {
          inventoryItemId,
          inventoryName: usage.inventoryName,
          unit: usage.unit,
          quantityPerServing: 0,
        };
        if (current.unit.toLowerCase() !== String(usage.unit).toLowerCase()) {
          throw httpError(409, `Inventory has inconsistent units configured for ${current.inventoryName}. Ask an admin to correct the menu recipe.`);
        }
        current.quantityPerServing = Math.round((current.quantityPerServing + Number(usage.quantityPerServing)) * 1000) / 1000;
        perItem.set(inventoryItemId, current);
        if (!inventoryNeeds.has(inventoryItemId)) inventoryNeeds.set(inventoryItemId, { inventoryName: usage.inventoryName, unit: usage.unit, required: 0 });
      };
      for (const ingredient of recipesByProduct.get(Number(line.product.id)) || []) addUsage(ingredient);
      for (const addon of line.addonPrices) addUsage(addon);
      line.inventoryConsumptions = [...perItem.values()];
      for (const usage of line.inventoryConsumptions) {
        const stock = inventoryNeeds.get(usage.inventoryItemId);
        stock.required = Math.round((stock.required + usage.quantityPerServing * line.quantity) * 1000) / 1000;
      }
    }

    const inventoryIds = [...inventoryNeeds.keys()].sort((left, right) => left - right);
    if (inventoryIds.length) {
      const marks = inventoryIds.map(() => "?").join(",");
      const [lockedInventory] = await connection.execute(
        `SELECT id, name, unit, quantity FROM inventory_items WHERE id IN (${marks}) ORDER BY id FOR UPDATE`, inventoryIds,
      );
      const inventoryById = new Map(lockedInventory.map((item) => [Number(item.id), item]));
      if (inventoryById.size !== inventoryIds.length) throw httpError(409, "A recipe ingredient or add-on is missing from Inventory. Update the menu item before ordering.");
      for (const [inventoryItemId, needed] of inventoryNeeds) {
        const item = inventoryById.get(inventoryItemId);
        if (item.unit.trim().toLowerCase() !== needed.unit.trim().toLowerCase()) {
          throw httpError(409, `${needed.inventoryName} uses a different unit from Inventory. Ask an admin to update the menu item.`);
        }
        needed.inventoryName = item.name;
        needed.quantity = Number(item.quantity);
        if (needed.quantity < needed.required) {
          throw httpError(409, `Not enough ${needed.inventoryName} in Inventory. Need ${needed.required} ${needed.unit}, have ${needed.quantity} ${needed.unit}.`);
        }
      }
    }

    const tendered = paymentMethod === "Cash" ? Number(request.body.cashTendered ?? total) : null;
    if (tendered != null && (!Number.isFinite(tendered) || tendered < total)) throw httpError(400, "Cash tendered must cover the order total.");
    const change = tendered == null ? null : Math.round((tendered - total) * 100) / 100;
    const [created] = await connection.execute(
      `INSERT INTO orders (order_number, customer_name, order_type, order_status, payment_status, payment_method, subtotal, total, cash_tendered, change_due, paid_at, created_by)
       VALUES (?, ?, ?, 'Pending', 'Paid', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [orderNumber, customer, type, paymentMethod, total, total, tendered, change, request.authUser.sub],
    );

    for (const [inventoryItemId, ingredient] of inventoryNeeds) {
      if (ingredient.required <= 0) continue;
      const [stockResult] = await connection.execute(
        "UPDATE inventory_items SET quantity = quantity - ? WHERE id = ? AND quantity >= ?",
        [ingredient.required, inventoryItemId, ingredient.required],
      );
      if (!stockResult.affectedRows) {
        throw httpError(409, `${ingredient.inventoryName} stock changed while the order was being placed. Please try again.`);
      }
    }

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
      for (const ingredient of line.inventoryConsumptions) {
        const quantityUsed = Math.round(ingredient.quantityPerServing * line.quantity * 1000) / 1000;
        await connection.execute(
          `INSERT INTO order_inventory_consumptions
             (order_id, order_item_id, order_number, product_name_snapshot, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [created.insertId, createdItem.insertId, orderNumber, line.product.name, ingredient.inventoryItemId, ingredient.inventoryName, quantityUsed, ingredient.unit],
        );
        await connection.execute(
          "INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'usage', ?, ?)",
          [ingredient.inventoryItemId, request.authUser.sub, -quantityUsed, `Order ${orderNumber}: ${line.product.name} × ${line.quantity}`],
        );
      }
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
    const [[order]] = await connection.execute("SELECT id, order_number, order_status FROM orders WHERE order_number = ? FOR UPDATE", [request.params.orderNumber]);
    if (!order) throw httpError(404, "Order not found.");
    const [items] = await connection.execute("SELECT product_id, SUM(quantity) AS quantity FROM order_items WHERE order_id = ? GROUP BY product_id", [order.id]);
    if (order.order_status !== "Completed") {
      for (const item of items) {
        if (item.product_id != null) await connection.execute("UPDATE menu_products SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.product_id]);
      }
      const [consumptions] = await connection.execute(
        "SELECT id, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit FROM order_inventory_consumptions WHERE order_id = ? AND reversed_at IS NULL FOR UPDATE",
        [order.id],
      );
      for (const consumption of consumptions) {
        const quantity = Number(consumption.quantity_used);
        await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?", [quantity, consumption.inventory_item_id]);
        await connection.execute(
          "INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'adjustment', ?, ?)",
          [consumption.inventory_item_id, request.authUser.sub, quantity, `Canceled order ${order.order_number}: restore ${consumption.inventory_item_name_snapshot}`],
        );
        await connection.execute("UPDATE order_inventory_consumptions SET reversed_at = CURRENT_TIMESTAMP WHERE id = ?", [consumption.id]);
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
