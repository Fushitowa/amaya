import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { toInventoryQuantity } from "../utils/inventoryUnits.js";
import { postOrderSaleAndCogs } from "../utils/ledgerService.js";
import { parseOptionalClientRequestId } from "../utils/validation.js";
import { loadBusinessSettings } from "./settings.js";
import {
  findUnusedOrderNumber,
  loadOrderByNumber,
  loadOrders,
  loadOrderSummary,
  normalizeBaseSizeLabel,
  ORDER_FLOW as orderFlow,
  ORDER_TYPES as orderTypes,
  PAYMENT_METHODS as paymentMethods,
  selectRecipe,
  VALID_ORDER_STATUSES,
} from "../services/ordersQueryService.js";
import {
  executeOrderItemRevert,
  executeVoidOrder,
} from "../services/ordersReversalService.js";

export { selectRecipe };

const router = Router();

router.get("/summary", requireAuth, requireRole("admin"), async (_request, response) => {
  response.json(await loadOrderSummary());
});

router.get("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const limit = Math.min(Math.max(1, Number(request.query?.limit || 500)), 5000);
  const includeCost = request.authUser.role === "admin";
  let statuses = null;
  if (request.query?.status !== undefined && String(request.query.status).trim() !== "") {
    statuses = [...new Set(
      String(request.query.status)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )];
    for (const s of statuses) {
      if (!VALID_ORDER_STATUSES.has(s)) {
        throw httpError(400, `Invalid status filter '${s}'. Allowed: Pending, Preparing, Completed, Cancelled.`);
      }
    }
  }
  response.json(await loadOrders(limit, { includeCost, statuses }));
});

router.get("/active-queue", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const includeCost = request.authUser.role === "admin";
  response.json(await loadOrders(null, { includeCost, statuses: ["Pending", "Preparing"] }));
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
  const rawType = request.body?.type;
  if (rawType !== undefined && rawType !== null && String(rawType).trim() !== "" && !orderTypes.includes(rawType)) {
    throw httpError(400, `Invalid order type. Allowed: ${orderTypes.join(", ")}.`);
  }
  const type = rawType ? String(rawType) : "Takeout";
  const rawPaymentMethod = request.body?.paymentMethod;
  if (
    rawPaymentMethod !== undefined &&
    rawPaymentMethod !== null &&
    String(rawPaymentMethod).trim() !== "" &&
    !paymentMethods.includes(rawPaymentMethod)
  ) {
    throw httpError(400, `Invalid payment method. Allowed: ${paymentMethods.join(", ")}.`);
  }
  const paymentMethod = rawPaymentMethod ? String(rawPaymentMethod) : "Cash";
  const cleanClientRequestId = parseOptionalClientRequestId(request.body?.clientRequestId);
  const customer = String(request.body.customerName || "Walk-in Customer").trim().slice(0, 160) || "Walk-in Customer";
  const orderNotes = String(request.body?.notes || "").trim().slice(0, 500) || null;
  const validatedItems = items.map((item) => {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1000) {
      throw httpError(400, "Each order item needs a valid menu item and quantity.");
    }
    return { item, productId, quantity };
  });

  if (cleanClientRequestId) {
    const [[existingOrder]] = await pool.execute(
      "SELECT id, order_number FROM orders WHERE created_by = ? AND client_request_id = ? LIMIT 1",
      [request.authUser.sub, cleanClientRequestId],
    );
    if (existingOrder) {
      const loaded = await loadOrderByNumber(existingOrder.order_number, {
        includeCost: request.authUser.role === "admin",
      });
      if (
        loaded &&
        loaded.type === type &&
        loaded.paymentMethod === paymentMethod &&
        (loaded.items?.length || 0) === validatedItems.length
      ) {
        return response.status(200).json(loaded);
      }
      throw httpError(409, "Client request ID was already used for a different order.");
    }
  }

  const bizSettings = await loadBusinessSettings();
  const connection = await pool.getConnection();
  let orderNumber;
  let txOpen = false;
  try {
    await connection.beginTransaction();
    txOpen = true;
    orderNumber = await findUnusedOrderNumber(connection);
    const [[activeSession]] = await connection.execute(
      "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1 FOR UPDATE",
      [request.authUser.sub],
    );
    const sessionId = activeSession ? Number(activeSession.id) : null;
    if (bizSettings.enforceShiftGate && !activeSession) {
      throw httpError(409, "Open a cashier shift before placing orders (Shift Gate is active in Settings).");
    }

    const sortedProductIds = [...new Set(validatedItems.map((entry) => entry.productId))].sort((a, b) => a - b);
    const lockProductMarks = sortedProductIds.map(() => "?").join(",");
    const [lockedProducts] = await connection.execute(
      `SELECT p.id, p.name, p.base_price, p.cost_price, p.stock_quantity, p.is_available, c.name AS category
         FROM menu_products p LEFT JOIN menu_categories c ON c.id = p.category_id
        WHERE p.id IN (${lockProductMarks}) AND p.is_archived = FALSE
        ORDER BY p.id ASC
          FOR UPDATE`,
      sortedProductIds,
    );
    const productsById = new Map(lockedProducts.map((row) => [Number(row.id), row]));

    const lineItems = [];
    let subtotal = 0;

    for (const { item, productId, quantity } of validatedItems) {
      const product = productsById.get(productId);
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
      subtotal = Math.round((subtotal + unitPrice * quantity) * 100) / 100;
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

    let discountAmount = 0;
    let discountLabel = null;
    const requestedDiscountLabel = String(request.body?.discountLabel || "").trim();
    if (requestedDiscountLabel) {
      const matchedPreset = (bizSettings.discountPresets || []).find(
        (p) => String(p.label || "").trim().toLowerCase() === requestedDiscountLabel.toLowerCase(),
      );
      if (!matchedPreset) {
        throw httpError(400, "Selected discount preset is not configured in Business Settings.");
      }
      discountLabel = matchedPreset.label;
      discountAmount = Math.min(
        subtotal,
        Math.round(((subtotal * Number(matchedPreset.pct || 0)) / 100) * 100) / 100,
      );
    } else if (
      request.body?.discountAmount !== undefined &&
      request.body.discountAmount !== null &&
      Number(request.body.discountAmount) > 0
    ) {
      if (request.authUser.role !== "admin") {
        throw httpError(403, "Only admins may apply custom unconfigured discounts.");
      }
      const parsedDiscount = Number(request.body.discountAmount);
      if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0 || parsedDiscount > subtotal) {
        throw httpError(400, "Discount amount must be between 0 and the order subtotal.");
      }
      discountAmount = Math.round(parsedDiscount * 100) / 100;
      discountLabel = "Custom Admin Discount";
    }

    const netTaxable = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
    const taxAmount = bizSettings.vatEnabled && Number(bizSettings.vatRatePercent) > 0
      ? Math.round(((netTaxable * Number(bizSettings.vatRatePercent)) / 100) * 100) / 100
      : 0;
    const total = Math.round((netTaxable + taxAmount) * 100) / 100;

    const tendered = paymentMethod === "Cash" ? Number(request.body.cashTendered ?? total) : null;
    if (tendered != null && (!Number.isFinite(tendered) || tendered < total)) throw httpError(400, "Cash tendered must cover the order total.");
    const change = tendered == null ? null : Math.round((tendered - total) * 100) / 100;
    const cashierName = request.authUser?.displayName || (request.authUser?.role === "admin" ? "Admin (Owner)" : "Cashier 1");
    const [created] = await connection.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, discount_amount, discount_label, tax_amount, total, cash_tendered, change_due, paid_at, created_by, cashier_name,
         notes, paid_by, session_id, client_request_id
       ) VALUES (?, ?, ?, 'Pending', 'Paid', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        customer,
        type,
        paymentMethod,
        subtotal,
        discountAmount,
        discountLabel,
        taxAmount,
        total,
        tendered,
        change,
        request.authUser.sub,
        cashierName,
        orderNotes,
        request.authUser.sub,
        sessionId,
        cleanClientRequestId,
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

    let orderTotalCogs = 0;
    const consumptionRows = [];
    const movementRows = [];
    const addonRows = [];
    for (const line of lineItems) {
      // Only non-recipe products track stock via menu_products.stock_quantity (recipe items track ingredients).
      if (!line.hasRecipe) {
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
        orderTotalCogs += totalLineCost;
      } else if (productCostPrice > 0) {
        itemUnitCostSnapshot = Number(productCostPrice.toFixed(4));
        orderTotalCogs += productCostPrice * line.quantity;
      }

      const [createdItem] = await connection.execute(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, sugar_level, unit_price, unit_cost_snapshot, instructions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [created.insertId, line.product.id, line.product.name, line.product.category || "Menu item", line.quantity, line.sizeLabel, line.sugarLevel, line.unitPrice, itemUnitCostSnapshot, line.instructions],
      );
      for (const ingredient of lineConsumptions) {
        consumptionRows.push([
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
        ]);
        const beforeQuantity = runningStockByItem.get(ingredient.inventoryItemId) ?? 0;
        const afterQuantity = Math.round((beforeQuantity - ingredient.quantityUsed) * 1000000) / 1000000;
        runningStockByItem.set(ingredient.inventoryItemId, afterQuantity);
        movementRows.push([
          ingredient.inventoryItemId,
          request.authUser.sub,
          "usage",
          -ingredient.quantityUsed,
          `Order ${orderNumber}: ${line.product.name} × ${line.quantity}`,
          ingredient.inventoryName,
          cashierName,
          beforeQuantity,
          afterQuantity,
          ingredient.unit,
          created.insertId,
          sessionId,
        ]);
      }
      for (const addon of line.addonPrices) {
        addonRows.push([createdItem.insertId, addon.label, addon.price]);
      }
    }

    if (consumptionRows.length > 0) {
      await connection.query(
        `INSERT INTO order_inventory_consumptions
           (order_id, order_item_id, order_number, product_name_snapshot, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit, unit_cost_snapshot, line_cost, source)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           quantity_used = quantity_used + VALUES(quantity_used),
           line_cost = line_cost + VALUES(line_cost)`,
        [consumptionRows],
      );
    }
    if (movementRows.length > 0) {
      await connection.query(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, order_id, session_id
         ) VALUES ?`,
        [movementRows],
      );
    }
    if (addonRows.length > 0) {
      await connection.query(
        "INSERT INTO order_item_addons (order_item_id, addon_name_snapshot, addon_price_snapshot) VALUES ?",
        [addonRows],
      );
    }

    await postOrderSaleAndCogs(connection, {
      orderId: created.insertId,
      orderNumber,
      total,
      subtotal,
      discountAmount,
      taxAmount,
      paymentMethod,
      totalCogs: orderTotalCogs,
      sessionId,
      userId: request.authUser.sub,
    });

    await connection.commit();
    txOpen = false;
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    if (error.code === "ER_DUP_ENTRY" && cleanClientRequestId) {
      const [[existingOrder]] = await pool.execute(
        "SELECT id, order_number FROM orders WHERE created_by = ? AND client_request_id = ? LIMIT 1",
        [request.authUser.sub, cleanClientRequestId],
      );
      if (existingOrder) {
        const loaded = await loadOrderByNumber(existingOrder.order_number, {
          includeCost: request.authUser.role === "admin",
        });
        if (
          loaded &&
          loaded.type === type &&
          loaded.paymentMethod === paymentMethod &&
          (loaded.items?.length || 0) === validatedItems.length
        ) {
          return response.status(200).json(loaded);
        }
        throw httpError(409, "Client request ID was already used for a different order.");
      }
    }
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
    const target = orderFlow.indexOf(request.body?.status);
    if (current < 0 || target <= current) {
      throw httpError(409, "Orders can only advance forward.");
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
      "SELECT id, order_number, order_status, payment_status, payment_method, subtotal, discount_amount, tax_amount, total, cash_tendered, change_due, paid_at, owner_confirmed_at, session_id FROM orders WHERE order_number = ? FOR UPDATE",
      [request.params.orderNumber],
    );
    if (!order) throw httpError(404, "Order not found.");
    if (order.order_status === "Cancelled") throw httpError(409, "Cancelled orders cannot be modified.");
    if (order.payment_status === "Paid" || order.owner_confirmed_at != null) {
      throw httpError(409, "Paid or owner-confirmed orders cannot be altered directly. Use an admin adjustment/void.");
    }

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

    const [[cogsRow]] = await connection.execute(
      `SELECT COALESCE((SELECT SUM(line_cost) FROM order_inventory_consumptions WHERE order_id = ? AND reversed_at IS NULL), 0) AS inv_cogs,
              COALESCE((
                SELECT SUM(oi.quantity * COALESCE(oi.unit_cost_snapshot, 0))
                  FROM order_items oi
                 WHERE oi.order_id = ?
                   AND NOT EXISTS (
                     SELECT 1 FROM order_inventory_consumptions oic
                      WHERE oic.order_item_id = oi.id AND COALESCE(oic.line_cost, 0) > 0 AND oic.reversed_at IS NULL
                   )
              ), 0) AS direct_cogs`,
      [order.id, order.id],
    );
    const totalOrderCogs = Number(cogsRow?.inv_cogs || 0) + Number(cogsRow?.direct_cogs || 0);
    await postOrderSaleAndCogs(connection, {
      orderId: order.id,
      orderNumber: order.order_number,
      total: orderTotal,
      subtotal: Number(order.subtotal ?? orderTotal),
      discountAmount: Number(order.discount_amount ?? 0),
      taxAmount: Number(order.tax_amount ?? 0),
      paymentMethod: nextMethod,
      totalCogs: totalOrderCogs,
      sessionId: order.session_id ? Number(order.session_id) : null,
      userId: actorId,
    });

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
  response.json(await executeVoidOrder({
    orderNumber: request.params.orderNumber,
    reason,
    restoreStock,
    actorId,
    actorName,
  }));
});

router.post("/:orderNumber/items/:itemId/revert", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const reason = String(request.body?.reason || "").trim();
  if (reason.length < 3 || reason.length > 255) {
    throw httpError(400, "A revert reason between 3 and 255 characters is required.");
  }
  const authPassword = String(request.body?.authorizationPassword ?? request.body?.adminPassword ?? "");
  if (authPassword && Buffer.byteLength(authPassword, "utf8") > 72) {
    throw httpError(400, "Authorization password must not exceed 72 bytes.");
  }
  const restoreStock = request.body?.restoreStock !== false;
  const cleanClientRequestId = parseOptionalClientRequestId(request.body?.clientRequestId);
  const actorId = request.authUser.sub;
  const actorName = request.authUser?.displayName || request.authUser?.username || (request.authUser.role === "admin" ? "Admin" : "Staff");

  response.json(await executeOrderItemRevert({
    orderNumber: request.params.orderNumber,
    itemId: request.params.itemId,
    reason,
    authPassword,
    restoreStock,
    requestedQty: request.body?.quantity,
    cleanClientRequestId,
    actorId,
    actorName,
    actorRole: request.authUser.role,
  }));
});

router.delete("/:orderNumber", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  response.status(405).json({
    message: "Orders cannot be permanently deleted. Use Void Order (Cancelled) instead.",
  });
});

export default router;
