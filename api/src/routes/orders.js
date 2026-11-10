import { randomInt } from "node:crypto";
import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { toInventoryQuantity } from "../utils/inventoryUnits.js";

// A size with its own recipe rows uses them exclusively; only a size with none falls back to the base recipe.
export const selectRecipe = (sizeRecipe, baseRecipe) => (sizeRecipe.length ? sizeRecipe : baseRecipe);

const router = Router();
const orderFlow = ["Pending", "Preparing", "Completed"];
const paymentMethods = ["Cash", "GCash", "Card"];
const orderTypes = ["Counter", "Takeout", "Dine-in"];

function formatManilaOrderStamp(date = new Date()) {
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

function getManilaTodayBounds() {
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

function normalizeBaseSizeLabel(label) {
  const cleaned = String(label || "Regular")
    .replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:fl\s*)?oz\s*\)\s*$/i, "")
    .trim()
    .toLowerCase();
  return cleaned || "regular";
}

function mapOrderRecord(
  order,
  items,
  addons,
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
    items: items
      .filter((item) => Number(item.order_id) === Number(order.id))
      .map((item) => {
        const snapshotVal = item.unit_cost_snapshot == null ? null : Number(item.unit_cost_snapshot);
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
          addons: addons
            .filter((addon) => Number(addon.order_item_id) === Number(item.id))
            .map((addon) => addon.addon_name_snapshot),
          instructions: item.instructions,
          notes: item.instructions,
        };
      }),
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
    if (includeCost) {
      mapped.consumptions = consumptions.map((c) => ({
        id: Number(c.id),
        orderItemId: c.order_item_id == null ? null : Number(c.order_item_id),
        inventoryItemId: Number(c.inventory_item_id),
        itemName: c.current_item_name || c.inventory_item_name_snapshot,
        productName: c.product_name_snapshot,
        quantity: Number(c.quantity_used),
        quantityUsed: Number(c.quantity_used),
        unit: c.unit,
        unitCostSnapshot: Number(c.unit_cost_snapshot || 0),
        lineCost: Number(c.line_cost || 0),
        source: c.source || "recipe",
        reversedAt: c.reversed_at ? new Date(c.reversed_at).toISOString() : null,
      }));
    }
  }
  return mapped;
}

const ORDER_WITH_ACTORS_SELECT = `
  SELECT orders.*,
         NULLIF(u.display_name, '') AS creator_display_name,
         COALESCE(NULLIF(uc.display_name, ''), uc.username) AS confirmed_by_name,
         COALESCE(NULLIF(up.display_name, ''), up.username) AS paid_by_name,
         COALESCE(NULLIF(uco.display_name, ''), uco.username) AS completed_by_name,
         COALESCE(NULLIF(uv.display_name, ''), uv.username) AS voided_by_name
    FROM orders
    LEFT JOIN users u ON u.id = orders.created_by
    LEFT JOIN users uc ON uc.id = orders.confirmed_by
    LEFT JOIN users up ON up.id = orders.paid_by
    LEFT JOIN users uco ON uco.id = orders.completed_by
    LEFT JOIN users uv ON uv.id = orders.voided_by
`;

async function loadOrders(limit = 500, { includeCost = false } = {}) {
  const safeLimit = Math.min(Math.max(1, Number(limit || 500)), 5000);
  const [orders] = await pool.query(
    `${ORDER_WITH_ACTORS_SELECT} ORDER BY orders.created_at DESC, orders.id DESC LIMIT ?`,
    [safeLimit],
  );
  if (!orders.length) return [];
  const ids = orders.map((order) => order.id);
  const marks = ids.map(() => "?").join(",");
  const [itemResult, addonResult] = await Promise.all([
    pool.execute("SELECT oi.*, p.name AS current_product_name FROM order_items oi LEFT JOIN menu_products p ON p.id = oi.product_id WHERE oi.order_id IN (" + marks + ") ORDER BY oi.id", ids),
    pool.execute("SELECT oia.*, oi.order_id FROM order_item_addons oia JOIN order_items oi ON oi.id = oia.order_item_id WHERE oi.order_id IN (" + marks + ") ORDER BY oia.id", ids),
  ]);
  const items = itemResult[0];
  const addons = addonResult[0];
  return orders.map((order) => mapOrderRecord(order, items, addons, { includeCost }));
}

async function loadOrderByNumber(orderNumber, { includeCost = false, includeDetails = false } = {}) {
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
    if (includeCost) {
      queries.push(
        pool.execute(
          `SELECT c.*, ii.name AS current_item_name
             FROM order_inventory_consumptions c
             LEFT JOIN inventory_items ii ON ii.id = c.inventory_item_id
            WHERE c.order_id = ?
            ORDER BY c.order_item_id ASC, c.source ASC, c.id ASC`,
          [order.id],
        ),
      );
    }
  }
  const results = await Promise.all(queries);
  const items = results[0][0];
  const addons = results[1][0];
  const statusEvents = includeDetails ? results[2][0] : [];
  const consumptions = includeDetails && includeCost ? results[3][0] : [];
  return mapOrderRecord(order, items, addons, { includeCost, includeDetails, statusEvents, consumptions });
}

async function findUnusedOrderNumber(connection) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const datePart = formatManilaOrderStamp();
    const value = `AM-${datePart}-${String(randomInt(0, 1000000)).padStart(6, "0")}`;
    const [rows] = await connection.execute("SELECT id FROM orders WHERE order_number = ?", [value]);
    if (!rows.length) return value;
  }
  throw httpError(503, "Could not allocate an order number. Please try again.");
}

router.get("/summary", requireAuth, requireRole("admin"), async (_request, response) => {
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
  response.json({
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
  });
});

router.get("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const limit = Math.min(Math.max(1, Number(request.query?.limit || 500)), 5000);
  const includeCost = request.authUser.role === "admin";
  response.json(await loadOrders(limit, { includeCost }));
});

router.get("/:orderNumber", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const includeCost = request.authUser.role === "admin";
  const order = await loadOrderByNumber(request.params.orderNumber, {
    includeCost,
    includeDetails: true,
  });
  if (!order) throw httpError(404, "Order not found.");
  response.json(order);
});

router.post("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const items = Array.isArray(request.body?.items) ? request.body.items : [];
  if (!items.length || items.length > 100) throw httpError(400, "An order must contain between 1 and 100 items.");
  const type = orderTypes.includes(request.body.type) ? request.body.type : "Takeout";
  const paymentMethod = paymentMethods.includes(request.body.paymentMethod) ? request.body.paymentMethod : "Cash";
  const customer = String(request.body.customerName || "Walk-in Customer").trim().slice(0, 160) || "Walk-in Customer";
  const orderNotes = String(request.body?.notes || "").trim().slice(0, 500) || null;
  const connection = await pool.getConnection();
  let orderNumber;
  try {
    await connection.beginTransaction();
    orderNumber = await findUnusedOrderNumber(connection);
    const [[activeSession]] = await connection.execute(
      "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
      [request.authUser.sub],
    );
    const sessionId = activeSession ? Number(activeSession.id) : null;
    const lineItems = [];
    let total = 0;

    for (const item of items) {
      const productId = Number(item.productId);
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000) {
        throw httpError(400, "Each order item needs a valid menu item and quantity.");
      }
      const [[product]] = await connection.execute(
        `SELECT p.id, p.name, p.base_price, p.cost_price, p.stock_quantity, p.is_available, c.name AS category
           FROM menu_products p LEFT JOIN menu_categories c ON c.id = p.category_id WHERE p.id = ? AND p.is_archived = FALSE FOR UPDATE`,
        [productId],
      );
      if (!product || !product.is_available) throw httpError(409, "A selected menu item is unavailable.");

      const requestedSizeLabel = String(item.size || "Regular").trim().slice(0, 80);
      const [productSizes] = await connection.execute(
        "SELECT id, label, price FROM product_sizes WHERE product_id = ? ORDER BY display_order ASC, id ASC",
        [productId],
      );
      let size = productSizes.find(
        (s) => String(s.label || "").trim().toLowerCase() === requestedSizeLabel.toLowerCase(),
      );
      if (!size) {
        const targetBase = normalizeBaseSizeLabel(requestedSizeLabel);
        const baseMatches = productSizes.filter((s) => normalizeBaseSizeLabel(s.label) === targetBase);
        if (baseMatches.length === 1) {
          size = baseMatches[0];
        }
      }
      if (!size) throw httpError(400, `The selected size for ${product.name} is no longer available.`);
      const canonicalSizeLabel = String(size.label).trim().slice(0, 80);
      const addonNames = Array.isArray(item.addons) ? [...new Set(item.addons.map((addon) => String(addon).trim()).filter(Boolean))] : [];
      const addonPrices = [];
      for (const addonName of addonNames) {
        const [[addon]] = await connection.execute(
          `SELECT pa.label, pa.price, pa.inventory_item_id, pa.quantity_used, pa.usage_unit,
                  i.name AS inventory_name, i.unit AS inventory_unit
             FROM product_addons pa LEFT JOIN inventory_items i ON i.id = pa.inventory_item_id
            WHERE pa.product_id = ? AND pa.label = ?`,
          [productId, addonName],
        );
        if (!addon) throw httpError(400, `An add-on for ${product.name} is no longer available.`);
        const stockQuantityPerServing = toInventoryQuantity(addon.quantity_used, addon.usage_unit || addon.inventory_unit, addon.inventory_unit);
        if (!addon.inventory_item_id || !stockQuantityPerServing || !addon.inventory_unit) {
          throw httpError(409, `${addon.label} needs Inventory setup. Ask an admin to edit and save ${product.name} in Menu Management first.`);
        }
        addonPrices.push({
          label: addon.label,
          price: Number(addon.price),
          inventoryItemId: Number(addon.inventory_item_id),
          inventoryName: addon.inventory_name,
          unit: addon.inventory_unit,
          quantityPerServing: stockQuantityPerServing,
        });
      }
      const unitPrice = Number((Number(size.price) + addonPrices.reduce((sum, addon) => sum + addon.price, 0)).toFixed(2));
      const clientUnitPrice = item.expectedUnitPrice ?? item.price;
      if (clientUnitPrice !== undefined && clientUnitPrice !== null && clientUnitPrice !== "") {
        const expectedPrice = Number(clientUnitPrice);
        if (!Number.isFinite(expectedPrice) || Math.abs(unitPrice - expectedPrice) > 0.01) {
          throw httpError(400, `The price for ${product.name} (${canonicalSizeLabel}) does not match the current menu price.`);
        }
      }
      total = Math.round((total + unitPrice * quantity) * 100) / 100;
      const itemInstructions = String(item.instructions || item.notes || "").trim().slice(0, 500) || null;
      lineItems.push({
        product,
        quantity,
        sizeId: Number(size.id),
        sizeLabel: canonicalSizeLabel,
        unitPrice,
        addonPrices,
        sugarLevel: String(item.sugarLevel || "").slice(0, 40) || null,
        instructions: itemInstructions,
      });
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
    const selectedSizeIds = [...new Set(lineItems.map((line) => line.sizeId))];
    const sizeMarks = selectedSizeIds.map(() => "?").join(",");
    const [sizeRecipeRows] = await connection.execute(
      `SELECT psi.product_size_id, psi.inventory_item_id, psi.quantity_used, psi.unit AS recipe_unit,
              i.name AS inventory_name, i.unit AS inventory_unit
         FROM product_size_ingredients psi
         JOIN inventory_items i ON i.id = psi.inventory_item_id
        WHERE psi.product_size_id IN (${sizeMarks})
        ORDER BY psi.inventory_item_id, psi.product_size_id`,
      selectedSizeIds,
    );
    const recipesByProduct = new Map();
    const recipesBySize = new Map();
    const inventoryNeeds = new Map();
    recipeRows.forEach((ingredient) => {
      const productId = Number(ingredient.product_id);
      const inventoryItemId = Number(ingredient.inventory_item_id);
      const quantityPerServing = Number(ingredient.quantity_used);
      const recipeUnit = String(ingredient.recipe_unit || "").trim();
      const inventoryUnit = String(ingredient.inventory_unit || "").trim();
      const stockQuantityPerServing = toInventoryQuantity(quantityPerServing, recipeUnit, inventoryUnit);
      if (!stockQuantityPerServing) {
        throw httpError(409, `The recipe for ${lineItems.find((line) => Number(line.product.id) === productId)?.product.name || "a menu item"} is incomplete or its units cannot be converted to Inventory. Update its recipe before ordering.`);
      }
      const entries = recipesByProduct.get(productId) || [];
      entries.push({
        inventoryItemId,
        inventoryName: ingredient.inventory_name,
        unit: inventoryUnit,
        quantityPerServing: stockQuantityPerServing,
      });
      recipesByProduct.set(productId, entries);
      inventoryNeeds.set(inventoryItemId, {
        inventoryName: ingredient.inventory_name,
        unit: inventoryUnit,
        required: 0,
      });
    });
    sizeRecipeRows.forEach((ingredient) => {
      const sizeId = Number(ingredient.product_size_id);
      const entries = recipesBySize.get(sizeId) || [];
      entries.push({
        inventoryItemId: Number(ingredient.inventory_item_id),
        inventoryName: ingredient.inventory_name,
        unit: ingredient.inventory_unit,
        quantityPerServing: toInventoryQuantity(ingredient.quantity_used, ingredient.recipe_unit, ingredient.inventory_unit),
      });
      recipesBySize.set(sizeId, entries);
    });

    for (const line of lineItems) {
      const perItem = new Map();
      const addUsage = (usage, source) => {
        const inventoryItemId = Number(usage.inventoryItemId);
        const key = `${source}:${inventoryItemId}`;
        const current = perItem.get(key) || {
          source,
          inventoryItemId,
          inventoryName: usage.inventoryName,
          unit: usage.unit,
          quantityPerServing: 0,
        };
        if (current.unit.toLowerCase() !== String(usage.unit).toLowerCase()) {
          throw httpError(409, `Inventory has inconsistent units configured for ${current.inventoryName}. Ask an admin to correct the menu recipe.`);
        }
        current.quantityPerServing = Math.round((current.quantityPerServing + Number(usage.quantityPerServing)) * 1000000) / 1000000;
        perItem.set(key, current);
        if (!inventoryNeeds.has(inventoryItemId)) {
          inventoryNeeds.set(inventoryItemId, { inventoryName: usage.inventoryName, unit: usage.unit, required: 0 });
        }
      };
      const sizeRecipe = recipesBySize.get(line.sizeId) || [];
      const activeRecipe = selectRecipe(sizeRecipe, recipesByProduct.get(Number(line.product.id)) || []);
      line.hasRecipe = activeRecipe.length > 0;
      for (const ingredient of activeRecipe) {
        if (!ingredient.quantityPerServing) throw httpError(409, `The ${line.sizeLabel} recipe for ${line.product.name} has an invalid inventory unit conversion.`);
        addUsage(ingredient, "recipe");
      }
      for (const addon of line.addonPrices) addUsage(addon, "addon");
      line.inventoryConsumptions = [...perItem.values()];
      for (const usage of line.inventoryConsumptions) {
        const stock = inventoryNeeds.get(usage.inventoryItemId);
        stock.required = Math.round((stock.required + usage.quantityPerServing * line.quantity) * 1000000) / 1000000;
      }
    }

    // Enforce cumulative product stock_quantity ONLY for non-recipe lines
    const nonRecipeProductTotals = new Map();
    for (const line of lineItems) {
      if (line.hasRecipe) continue;
      const pid = Number(line.product.id);
      const existing = nonRecipeProductTotals.get(pid) || { product: line.product, totalQty: 0 };
      existing.totalQty += line.quantity;
      nonRecipeProductTotals.set(pid, existing);
    }
    for (const entry of nonRecipeProductTotals.values()) {
      if (Number(entry.product.stock_quantity) < entry.totalQty) {
        throw httpError(409, `${entry.product.name} does not have enough stock for this order.`);
      }
    }

    const runningStockByItem = new Map();
    const inventoryIds = [...inventoryNeeds.keys()].sort((left, right) => left - right);
    if (inventoryIds.length) {
      const marks = inventoryIds.map(() => "?").join(",");
      const [lockedInventory] = await connection.execute(
        `SELECT id, name, unit, quantity, unit_cost FROM inventory_items WHERE id IN (${marks}) ORDER BY id FOR UPDATE`,
        inventoryIds,
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
        needed.unitCost = Number(item.unit_cost || 0);
        runningStockByItem.set(inventoryItemId, needed.quantity);
        if (needed.quantity < needed.required) {
          throw httpError(409, `Not enough ${needed.inventoryName} in Inventory. Need ${needed.required} ${needed.unit}, have ${needed.quantity} ${needed.unit}.`);
        }
      }
    }

    const tendered = paymentMethod === "Cash" ? Number(request.body.cashTendered ?? total) : null;
    if (tendered != null && (!Number.isFinite(tendered) || tendered < total)) throw httpError(400, "Cash tendered must cover the order total.");
    const change = tendered == null ? null : Math.round((tendered - total) * 100) / 100;
    const cashierName = request.authUser?.displayName || (request.authUser?.role === "admin" ? "Admin (Owner)" : "Cashier 1");
    const [created] = await connection.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, cash_tendered, change_due, paid_at, created_by, cashier_name,
         notes, paid_by, session_id
       ) VALUES (?, ?, ?, 'Pending', 'Paid', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        customer,
        type,
        paymentMethod,
        total,
        total,
        tendered,
        change,
        request.authUser.sub,
        cashierName,
        orderNotes,
        request.authUser.sub,
        sessionId,
      ],
    );

    await connection.execute(
      `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason)
       VALUES (?, NULL, 'Pending', ?, ?, 'Order created')`,
      [created.insertId, request.authUser.sub, cashierName],
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
      if (line.hasRecipe) {
        await connection.execute(
          "UPDATE menu_products SET stock_quantity = GREATEST(0, stock_quantity - ?) WHERE id = ?",
          [line.quantity, line.product.id],
        );
      } else {
        const [stockResult] = await connection.execute(
          "UPDATE menu_products SET stock_quantity = stock_quantity - ? WHERE id = ? AND stock_quantity >= ?",
          [line.quantity, line.product.id, line.quantity],
        );
        if (!stockResult.affectedRows) throw httpError(409, `${line.product.name} stock changed while the order was being placed. Please try again.`);
      }

      const lineConsumptions = line.inventoryConsumptions.map((ingredient) => {
        const quantityUsed = Math.round(ingredient.quantityPerServing * line.quantity * 1000000) / 1000000;
        const unitCostSnapshot = Number(inventoryNeeds.get(ingredient.inventoryItemId)?.unitCost || 0);
        const lineCost = Number((quantityUsed * unitCostSnapshot).toFixed(4));
        return {
          ...ingredient,
          quantityUsed,
          unitCostSnapshot,
          lineCost,
        };
      });
      const totalLineCost = lineConsumptions.reduce((sum, c) => sum + c.lineCost, 0);
      const productCostPrice = Number(line.product.cost_price || 0);
      let itemUnitCostSnapshot = null;
      if (lineConsumptions.length > 0 && totalLineCost > 0 && line.quantity > 0) {
        itemUnitCostSnapshot = Number((totalLineCost / line.quantity).toFixed(4));
      } else if (productCostPrice > 0) {
        itemUnitCostSnapshot = Number(productCostPrice.toFixed(4));
      }

      const [createdItem] = await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, sugar_level, unit_price, unit_cost_snapshot, instructions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, line.product.id, line.product.name, line.product.category || "Menu item", line.quantity, line.sizeLabel, line.sugarLevel, line.unitPrice, itemUnitCostSnapshot, line.instructions],
      );
      for (const ingredient of lineConsumptions) {
        await connection.execute(
          `INSERT INTO order_inventory_consumptions
             (order_id, order_item_id, order_number, product_name_snapshot, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit, unit_cost_snapshot, line_cost, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             quantity_used = quantity_used + VALUES(quantity_used),
             line_cost = line_cost + VALUES(line_cost)`,
          [
            created.insertId,
            createdItem.insertId,
            orderNumber,
            line.product.name,
            ingredient.inventoryItemId,
            ingredient.inventoryName,
            ingredient.quantityUsed,
            ingredient.unit,
            ingredient.unitCostSnapshot,
            ingredient.lineCost,
            ingredient.source,
          ],
        );
        const beforeQuantity = runningStockByItem.get(ingredient.inventoryItemId) ?? 0;
        const afterQuantity = Math.round((beforeQuantity - ingredient.quantityUsed) * 1000000) / 1000000;
        runningStockByItem.set(ingredient.inventoryItemId, afterQuantity);
        await connection.execute(
          `INSERT INTO inventory_movements (
             inventory_item_id, user_id, movement_type, quantity_change, note,
             item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, order_id, session_id
           ) VALUES (?, ?, 'usage', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ingredient.inventoryItemId,
            request.authUser.sub,
            -ingredient.quantityUsed,
            `Order ${orderNumber}: ${line.product.name} × ${line.quantity}`,
            ingredient.inventoryName,
            cashierName,
            beforeQuantity,
            afterQuantity,
            ingredient.unit,
            created.insertId,
            sessionId,
          ],
        );
      }
      for (const addon of line.addonPrices) {
        await connection.execute(
          "INSERT INTO order_item_addons (order_item_id, addon_name_snapshot, addon_price_snapshot) VALUES (?, ?, ?)",
          [createdItem.insertId, addon.label, addon.price],
        );
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  response.status(201).json(await loadOrderByNumber(orderNumber, {
    includeCost: request.authUser.role === "admin",
  }));
});

router.patch("/:orderNumber/status", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const actorId = request.authUser.sub;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Staff";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.execute(
      "SELECT id, order_status FROM orders WHERE order_number = ? FOR UPDATE",
      [request.params.orderNumber],
    );
    if (!order) throw httpError(404, "Order not found.");
    if (order.order_status === "Cancelled") throw httpError(409, "Cancelled orders cannot be modified.");
    const current = orderFlow.indexOf(order.order_status);
    if (current < 0 || request.body?.status !== orderFlow[current + 1]) {
      throw httpError(409, "Orders can only advance one step at a time.");
    }
    const nextStatus = request.body.status;
    if (nextStatus === "Completed") {
      await connection.execute(
        "UPDATE orders SET order_status = ?, completed_by = ?, completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) WHERE id = ?",
        [nextStatus, actorId, order.id],
      );
    } else {
      await connection.execute(
        "UPDATE orders SET order_status = ? WHERE id = ?",
        [nextStatus, order.id],
      );
    }
    await connection.execute(
      `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot)
       VALUES (?, ?, ?, ?, ?)`,
      [order.id, order.order_status, nextStatus, actorId, actorName],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  response.json(await loadOrderByNumber(request.params.orderNumber, {
    includeCost: request.authUser.role === "admin",
  }));
});

router.patch("/:orderNumber/confirm", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const actorId = request.authUser.sub;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Staff";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.execute(
      "SELECT id, order_status, confirmed_at FROM orders WHERE order_number = ? FOR UPDATE",
      [request.params.orderNumber],
    );
    if (!order) throw httpError(404, "Order not found.");
    if (order.order_status === "Cancelled") throw httpError(409, "Cancelled orders cannot be modified.");
    await connection.execute(
      "UPDATE orders SET confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP), confirmed_by = COALESCE(confirmed_by, ?) WHERE id = ?",
      [actorId, order.id],
    );
    if (!order.confirmed_at) {
      await connection.execute(
        `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason)
         VALUES (?, ?, ?, ?, ?, 'Order confirmed')`,
        [order.id, order.order_status, order.order_status, actorId, actorName],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  response.json(await loadOrderByNumber(request.params.orderNumber, {
    includeCost: request.authUser.role === "admin",
  }));
});

router.patch("/:orderNumber/payment", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const rawMethod = request.body?.paymentMethod;
  if (rawMethod !== undefined && !paymentMethods.includes(rawMethod)) {
    throw httpError(400, "Invalid payment method.");
  }
  const actorId = request.authUser.sub;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Staff";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.execute(
      "SELECT id, order_status, payment_status, payment_method, total, cash_tendered, change_due, paid_at FROM orders WHERE order_number = ? FOR UPDATE",
      [request.params.orderNumber],
    );
    if (!order) throw httpError(404, "Order not found.");
    if (order.order_status === "Cancelled") throw httpError(409, "Cancelled orders cannot be modified.");

    const nextMethod = rawMethod || order.payment_method || "Cash";
    const orderTotal = Number(order.total || 0);
    let nextTendered = order.cash_tendered == null ? null : Number(order.cash_tendered);
    let nextChange = order.change_due == null ? null : Number(order.change_due);

    if (nextMethod === "Cash") {
      if (request.body?.cashTendered !== undefined && request.body.cashTendered !== null && request.body.cashTendered !== "") {
        const parsedTendered = Number(request.body.cashTendered);
        if (!Number.isFinite(parsedTendered) || parsedTendered < orderTotal) {
          throw httpError(400, "Cash tendered must cover the order total.");
        }
        nextTendered = parsedTendered;
        nextChange = Math.round((parsedTendered - orderTotal) * 100) / 100;
      } else if (nextTendered == null) {
        nextTendered = orderTotal;
        nextChange = 0;
      }
    } else {
      nextTendered = null;
      nextChange = null;
    }

    await connection.execute(
      `UPDATE orders
          SET payment_status = 'Paid',
              payment_method = ?,
              cash_tendered = ?,
              change_due = ?,
              paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
              paid_by = COALESCE(paid_by, ?)
        WHERE id = ?`,
      [nextMethod, nextTendered, nextChange, actorId, order.id],
    );
    await connection.execute(
      `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [order.id, order.order_status, order.order_status, actorId, actorName, `Payment recorded (${nextMethod})`],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  response.json(await loadOrderByNumber(request.params.orderNumber, {
    includeCost: request.authUser.role === "admin",
  }));
});

router.post("/:orderNumber/void", requireAuth, requireRole("admin"), async (request, response) => {
  const reason = String(request.body?.reason || "").trim();
  if (reason.length < 3 || reason.length > 255) {
    throw httpError(400, "A void reason between 3 and 255 characters is required.");
  }
  const restoreStock = request.body?.restoreStock !== false;
  const actorId = request.authUser.sub;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.execute(
      "SELECT id, order_number, order_status FROM orders WHERE order_number = ? FOR UPDATE",
      [request.params.orderNumber],
    );
    if (!order) throw httpError(404, "Order not found.");
    if (order.order_status === "Cancelled") {
      throw httpError(409, "This order has already been voided.");
    }

    const [[activeSession]] = await connection.execute(
      "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
      [actorId],
    );
    const sessionId = activeSession ? Number(activeSession.id) : null;

    await connection.execute(
      `UPDATE orders
          SET order_status = 'Cancelled',
              voided_by = ?,
              voided_at = CURRENT_TIMESTAMP,
              void_reason = ?
        WHERE id = ?`,
      [actorId, reason, order.id],
    );
    await connection.execute(
      `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason)
       VALUES (?, ?, 'Cancelled', ?, ?, ?)`,
      [order.id, order.order_status, actorId, actorName, reason],
    );

    const [consumptions] = await connection.execute(
      `SELECT id, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit
         FROM order_inventory_consumptions
        WHERE order_id = ? AND reversed_at IS NULL
        ORDER BY inventory_item_id ASC, id ASC
          FOR UPDATE`,
      [order.id],
    );

    const distinctInventoryIds = [...new Set(consumptions.map((c) => Number(c.inventory_item_id)))].sort((a, b) => a - b);
    const runningStockByItem = new Map();
    if (distinctInventoryIds.length) {
      const marks = distinctInventoryIds.map(() => "?").join(",");
      const [lockedInventory] = await connection.execute(
        `SELECT id, name, quantity, unit FROM inventory_items WHERE id IN (${marks}) ORDER BY id FOR UPDATE`,
        distinctInventoryIds,
      );
      for (const inv of lockedInventory) {
        runningStockByItem.set(Number(inv.id), {
          name: inv.name,
          quantity: Number(inv.quantity),
          unit: inv.unit,
        });
      }
    }

    if (restoreStock) {
      for (const consumption of consumptions) {
        const invId = Number(consumption.inventory_item_id);
        const qty = Number(consumption.quantity_used);
        const state = runningStockByItem.get(invId);
        const beforeQuantity = state ? state.quantity : 0;
        const afterQuantity = Math.round((beforeQuantity + qty) * 1000000) / 1000000;
        if (state) state.quantity = afterQuantity;

        await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?", [qty, invId]);
        await connection.execute(
          `INSERT INTO inventory_movements (
             inventory_item_id, user_id, movement_type, quantity_change, note,
             item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, order_id, session_id
           ) VALUES (?, ?, 'void_restore', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invId,
            actorId,
            qty,
            `Voided order ${order.order_number}: ${reason}`.slice(0, 500),
            state?.name || consumption.inventory_item_name_snapshot,
            actorName,
            beforeQuantity,
            afterQuantity,
            state?.unit || consumption.unit,
            order.id,
            sessionId,
          ],
        );
        await connection.execute("UPDATE order_inventory_consumptions SET reversed_at = CURRENT_TIMESTAMP WHERE id = ?", [consumption.id]);
      }

      const [nonRecipeItems] = await connection.execute(
        `SELECT oi.product_id, SUM(oi.quantity) AS quantity
           FROM order_items oi
          WHERE oi.order_id = ?
            AND oi.product_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM order_inventory_consumptions oic
               WHERE oic.order_item_id = oi.id AND oic.source = 'recipe'
            )
          GROUP BY oi.product_id`,
        [order.id],
      );
      for (const item of nonRecipeItems) {
        await connection.execute(
          "UPDATE menu_products SET stock_quantity = stock_quantity + ? WHERE id = ?",
          [Number(item.quantity), item.product_id],
        );
      }
    } else {
      for (const consumption of consumptions) {
        const invId = Number(consumption.inventory_item_id);
        const state = runningStockByItem.get(invId);
        const currentQty = state ? state.quantity : 0;
        await connection.execute(
          `INSERT INTO inventory_movements (
             inventory_item_id, user_id, movement_type, quantity_change, note,
             item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, order_id, session_id
           ) VALUES (?, ?, 'spoilage', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invId,
            actorId,
            `Spoilage on voided order #${order.order_number}: ${reason}`.slice(0, 500),
            state?.name || consumption.inventory_item_name_snapshot,
            actorName,
            currentQty,
            currentQty,
            state?.unit || consumption.unit,
            order.id,
            sessionId,
          ],
        );
      }
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  response.json(await loadOrderByNumber(request.params.orderNumber, {
    includeCost: true,
    includeDetails: true,
  }));
});

router.delete("/:orderNumber", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  response.status(405).json({
    message: "Orders cannot be permanently deleted. Use Void Order (Cancelled) instead.",
  });
});

export default router;
