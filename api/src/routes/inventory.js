import { isWholeNumberUnit } from "../../../shared/units.js";
import { Router } from "express";
import { getIngredientCostFlow } from "../services/ingredientCostFlowService.js";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { escapeLikePattern, parseOptionalClientRequestId, parsePositiveIntId, validateImageUrl } from "../utils/validation.js";
import { recordArchiveAudit } from "./archive.js";
import { retargetRecipeUnits } from "../utils/recipeUnitSync.js";
import { getUnitDimension } from "../utils/inventoryUnits.js";
import {
  getManilaDateString,
  isValidIsoDateOnly,
  parseExactMoney,
  postBalancedEntry,
  postInventoryValuationDelta,
  resolveActiveSessionId,
} from "../utils/ledgerService.js";
import {
  parseStrictFiniteNumber,
  round2,
  round6,
  WASTE_REASON_VALUES,
} from "../utils/wasteMeasurement.js";
import {
  ALLOWED_INTERNAL_USE_ACCOUNTS,
  assertInternalUseReplayMatches,
  executeLogWaste,
  fetchMappedItemById,
  findExistingWasteByClientRequest,
  formatInternalUseResponseRow,
  formatWasteResponseRow,
  mapItem,
  mapMovementRow,
  resolveCosting,
  reverseDeductionMovement,
  syncCupRow,
  unitWithAmountError,
  VALID_MOVEMENT_TYPES,
} from "../services/inventoryMovementService.js";

const router = Router();

// --- Inventory Category Endpoints ---

router.get("/categories", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const showAll = Boolean(request.authUser && request.authUser.role === "admin")
    && request.query.all === "true";

  const [rows] = await pool.execute(
    `SELECT c.id, c.name, c.description, c.is_cup_category AS isCupCategory,
            c.is_system AS isSystem, c.display_order AS displayOrder,
            c.is_active AS isActive,
            COUNT(CASE WHEN i.is_archived = FALSE THEN 1 END) AS itemCount,
            COUNT(CASE WHEN i.is_archived = TRUE THEN 1 END) AS archivedItemCount
       FROM inventory_categories c
       LEFT JOIN inventory_items i ON i.category COLLATE utf8mb4_unicode_ci = c.name COLLATE utf8mb4_unicode_ci
      WHERE (? = 1 OR c.is_active = TRUE)
      GROUP BY c.id
      ORDER BY c.display_order ASC, c.name ASC`,
    [showAll ? 1 : 0],
  );

  response.json(rows.map((row) => {
    const itemCount = Number(row.itemCount || 0);
    const archivedItemCount = Number(row.archivedItemCount || 0);
    return {
      id: Number(row.id),
      name: row.name,
      description: row.description || "",
      isCupCategory: Boolean(row.isCupCategory),
      isSystem: Boolean(row.isSystem),
      displayOrder: Number(row.displayOrder || 0),
      isActive: Boolean(row.isActive),
      itemCount,
      archivedItemCount,
      totalCount: itemCount + archivedItemCount,
    };
  }));
});

router.post("/categories", requireAuth, requireRole("admin"), async (request, response) => {
  const name = String(request.body?.name || "").trim().slice(0, 100);
  if (!name) throw httpError(400, "Inventory category name is required.");

  const description = String(request.body?.description || "").trim().slice(0, 500) || null;
  const isCupCategory = Boolean(request.body?.isCupCategory);
  const displayOrder = Number.isInteger(Number(request.body?.displayOrder)) && Number(request.body?.displayOrder) >= 0
    ? Number(request.body.displayOrder)
    : 0;
  const isActive = request.body?.isActive === false ? 0 : 1;

  try {
    const [result] = await pool.execute(
      `INSERT INTO inventory_categories (name, description, is_cup_category, is_system, display_order, is_active)
       VALUES (?, ?, ?, FALSE, ?, ?)`,
      [name, description, isCupCategory ? 1 : 0, displayOrder, isActive],
    );

    response.status(201).json({
      id: Number(result.insertId),
      name,
      description: description || "",
      isCupCategory,
      isSystem: false,
      displayOrder,
      isActive: Boolean(isActive),
      itemCount: 0,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw httpError(409, `An inventory category named “${name}” already exists.`);
    }
    throw error;
  }
});

router.put("/categories/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid category ID.");

  const name = String(request.body?.name || "").trim().slice(0, 100);
  if (!name) throw httpError(400, "Category name cannot be empty.");

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.execute(
      "SELECT id, name, is_system, is_cup_category FROM inventory_categories WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!existing) throw httpError(404, "Inventory category not found.");

    const description = request.body?.description !== undefined
      ? (String(request.body.description || "").trim().slice(0, 500) || null)
      : null;
    const isCupCategory = request.body?.isCupCategory !== undefined
      ? Boolean(request.body.isCupCategory)
      : Boolean(existing.is_cup_category);
    const displayOrder = Number.isInteger(Number(request.body?.displayOrder)) && Number(request.body?.displayOrder) >= 0
      ? Number(request.body.displayOrder)
      : 0;
    const isActive = request.body?.isActive === false ? 0 : 1;

    // Update the category record
    await connection.execute(
      `UPDATE inventory_categories
          SET name = ?, description = ?, is_cup_category = ?, display_order = ?, is_active = ?
        WHERE id = ?`,
      [name, description, isCupCategory ? 1 : 0, displayOrder, isActive, id],
    );

    // Cascading update: update inventory_items when name changes
    if (existing.name !== name) {
      await connection.execute(
        "UPDATE inventory_items SET category = ? WHERE category = ?",
        [name, existing.name],
      );
    }

    await connection.commit();

    const [[countRow]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM inventory_items WHERE category = ? AND is_archived = FALSE",
      [name],
    );

    response.json({
      id,
      name,
      description: description || "",
      isCupCategory,
      isSystem: Boolean(existing.is_system),
      displayOrder,
      isActive: Boolean(isActive),
      itemCount: Number(countRow?.total || 0),
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      throw httpError(409, `An inventory category named “${name}” already exists.`);
    }
    throw error;
  } finally {
    connection.release();
  }
});

router.delete("/categories/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid category ID.");

  const [[category]] = await pool.execute(
    "SELECT id, name, is_system, is_cup_category FROM inventory_categories WHERE id = ?",
    [id],
  );
  if (!category) throw httpError(404, "Inventory category not found.");

  // Charlotte's Zero-Trust Check: block deletion if items (active or archived) are assigned
  const [[usage]] = await pool.execute(
    "SELECT COUNT(*) AS total FROM inventory_items WHERE category = ?",
    [category.name],
  );
  if (usage.total > 0) {
    throw httpError(409, `Cannot delete category “${category.name}”: ${usage.total} inventory item(s) are assigned to it. Reassign or remove them first.`);
  }

  await pool.execute("DELETE FROM inventory_categories WHERE id = ?", [id]);
  response.json({ message: `Inventory category “${category.name}” deleted successfully.`, id });
});

router.put("/categories/:id/reassign-and-delete", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  const targetId = Number(request.body?.targetCategoryId);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid source category ID.");
  if (!Number.isSafeInteger(targetId) || targetId <= 0 || targetId === id) {
    throw httpError(400, "Valid target category ID is required for reassignment.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[sourceCategory]] = await connection.execute(
      "SELECT id, name FROM inventory_categories WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!sourceCategory) throw httpError(404, "Source inventory category not found.");

    const [[targetCategory]] = await connection.execute(
      "SELECT id, name FROM inventory_categories WHERE id = ? FOR UPDATE",
      [targetId],
    );
    if (!targetCategory) throw httpError(404, "Target inventory category not found.");

    const [updateResult] = await connection.execute(
      "UPDATE inventory_items SET category = ? WHERE category = ?",
      [targetCategory.name, sourceCategory.name],
    );

    await connection.execute("DELETE FROM inventory_categories WHERE id = ?", [id]);

    await connection.commit();
    response.json({
      message: `Category “${sourceCategory.name}” deleted. Reassigned ${updateResult.affectedRows} item(s) to “${targetCategory.name}”.`,
      id,
      reassignedCount: updateResult.affectedRows,
    });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
});

router.get("/summary", requireAuth, requireRole("admin"), async (_request, response) => {
  const [rows] = await pool.execute(
    `SELECT
       COUNT(*) AS total_items,
       COALESCE(SUM(quantity * unit_cost), 0) AS total_value,
       COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count,
       COALESCE(SUM(CASE WHEN quantity > 0 AND maximum_stock IS NOT NULL AND quantity > maximum_stock THEN 1 ELSE 0 END), 0) AS over_maximum_count,
       COALESCE(SUM(CASE WHEN quantity > 0 AND (maximum_stock IS NULL OR quantity <= maximum_stock) THEN 1 ELSE 0 END), 0) AS in_stock_count
     FROM inventory_items WHERE is_archived = FALSE`,
  );
  const row = rows[0] || {};
  response.json({
    totalItems: Number(row.total_items || 0),
    totalValue: Number(Number(row.total_value || 0).toFixed(2)),
    outOfStockCount: Number(row.out_of_stock_count || 0),
    overMaximumCount: Number(row.over_maximum_count || 0),
    inStockCount: Number(row.in_stock_count || 0),
  });
});

router.get("/movements", requireAuth, requireRole("admin"), async (request, response) => {
  const { from, to, userId, type, itemId, search } = request.query || {};
  const conditions = [];
  const params = [];

  if (from !== undefined && from !== "") {
    if (!isValidIsoDateOnly(from)) throw httpError(400, "Invalid 'from' date. Expected YYYY-MM-DD.");
    conditions.push("m.created_at >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to !== undefined && to !== "") {
    if (!isValidIsoDateOnly(to)) throw httpError(400, "Invalid 'to' date. Expected YYYY-MM-DD.");
    conditions.push("m.created_at <= ?");
    params.push(`${to} 23:59:59`);
  }
  if (from && to && String(from) > String(to)) {
    throw httpError(400, "Start date must be on or before end date.");
  }
  if (userId !== undefined && userId !== "") {
    const parsedUserId = Number(userId);
    if (!Number.isSafeInteger(parsedUserId) || parsedUserId <= 0) throw httpError(400, "Invalid userId filter.");
    conditions.push("m.user_id = ?");
    params.push(parsedUserId);
  }
  if (itemId !== undefined && itemId !== "") {
    const parsedItemId = Number(itemId);
    if (!Number.isSafeInteger(parsedItemId) || parsedItemId <= 0) throw httpError(400, "Invalid itemId filter.");
    conditions.push("m.inventory_item_id = ?");
    params.push(parsedItemId);
  }
  if (type !== undefined && type !== "") {
    const cleanType = String(type).trim().toLowerCase();
    if (!VALID_MOVEMENT_TYPES.has(cleanType)) throw httpError(400, "Invalid movement type filter.");
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

  const page = Math.max(1, Number.parseInt(request.query?.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(request.query?.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [[summaryRow]] = await pool.query(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN m.movement_type = 'restock' THEN COALESCE(m.batch_cost, 0) ELSE 0 END), 0) AS total_expenditure
       FROM inventory_movements m
       LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
      ${whereClause}`,
    params,
  );
  const [rows] = await pool.query(
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
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  response.json({
    items: rows.map((row) => mapMovementRow(row, true)),
    total: Number(summaryRow?.total || 0),
    page,
    limit,
    totalExpenditure: Number(Number(summaryRow?.total_expenditure || 0).toFixed(2)),
  });
});

router.get("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const includeCost = request.authUser.role === "admin";
  const mediaMode = request.query?.media === "url" ? "url" : null;
  const [rows] = await pool.execute(`
    SELECT ii.*, COALESCE(ic.is_cup_category, FALSE) AS is_cup_category
      FROM inventory_items ii
      LEFT JOIN inventory_categories ic ON LOWER(ii.category) COLLATE utf8mb4_unicode_ci = LOWER(ic.name) COLLATE utf8mb4_unicode_ci
     WHERE ii.is_archived = FALSE
     ORDER BY ii.category, ii.name
  `);
  response.json(rows.map((row) => mapItem(row, includeCost, mediaMode)));
});

// Where the ingredient money went (actual vs theoretical food cost, waste and shrinkage). Admin only.
router.get("/cost-flow", requireAuth, requireRole("admin"), async (request, response) => {
  response.json(await getIngredientCostFlow({ from: request.query?.from, to: request.query?.to }));
});

router.get("/waste-logs", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const includeCost = request.authUser.role === "admin";
  const { from, to, itemId, reason, scope, includeOrderSpoilage } = request.query || {};
  const conditions = ["m.movement_type = 'spoilage'"];
  const params = [];

  if (String(includeOrderSpoilage || "").toLowerCase() !== "true") {
    conditions.push("m.order_id IS NULL");
    conditions.push("m.waste_reason IS NOT NULL");
  }

  if (from !== undefined && from !== "") {
    if (!isValidIsoDateOnly(from)) throw httpError(400, "Invalid 'from' date. Expected YYYY-MM-DD.");
    conditions.push("m.created_at >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to !== undefined && to !== "") {
    if (!isValidIsoDateOnly(to)) throw httpError(400, "Invalid 'to' date. Expected YYYY-MM-DD.");
    conditions.push("m.created_at <= ?");
    params.push(`${to} 23:59:59`);
  }
  if (from && to && String(from) > String(to)) {
    throw httpError(400, "Start date must be on or before end date.");
  }

  if (itemId !== undefined && itemId !== "") {
    const parsedItemId = Number(itemId);
    if (!Number.isSafeInteger(parsedItemId) || parsedItemId <= 0) {
      throw httpError(400, "Invalid itemId filter.");
    }
    conditions.push("m.inventory_item_id = ?");
    params.push(parsedItemId);
  }

  if (reason !== undefined && reason !== "") {
    const cleanReason = String(reason).trim().toLowerCase();
    if (!WASTE_REASON_VALUES.includes(cleanReason)) {
      throw httpError(400, "Invalid waste reason filter.");
    }
    conditions.push("m.waste_reason = ?");
    params.push(cleanReason);
  }

  const todayManila = getManilaDateString();
  const cleanScope = scope !== undefined && scope !== "" ? String(scope).trim().toLowerCase() : "";
  if (cleanScope && !["today", "shift", "all"].includes(cleanScope)) {
    throw httpError(400, "Invalid scope filter. Expected 'today', 'shift', or 'all'.");
  }

  if (cleanScope === "today") {
    conditions.push("m.created_at >= ? AND m.created_at <= ?");
    params.push(`${todayManila} 00:00:00`, `${todayManila} 23:59:59`);
  } else if (cleanScope === "shift") {
    const [[openShift]] = await pool.execute(
      "SELECT id FROM cashier_sessions WHERE status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
    );
    if (openShift) {
      conditions.push("m.session_id = ?");
      params.push(Number(openShift.id));
    } else {
      conditions.push("1 = 0");
    }
  }

  const page = Math.max(1, Number.parseInt(request.query?.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query?.limit, 10) || 30));
  const offset = (page - 1) * limit;
  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM inventory_movements m
       LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
      ${whereClause}`,
    params,
  );

  const [rows] = await pool.query(
    `SELECT m.*,
            COALESCE(ii.name, m.item_name_snapshot) AS item_name,
            ii.unit AS current_item_unit,
            COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name,
            o.order_number,
            je.id AS journal_entry_id
       FROM inventory_movements m
       LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN orders o ON o.id = m.order_id
       LEFT JOIN journal_entries je ON je.inventory_movement_id = m.id AND je.is_reversal = FALSE
      ${whereClause}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  const [[todaySummary]] = await pool.query(
    `SELECT COUNT(*) AS today_events,
            COALESCE(SUM(COALESCE(m.batch_cost, 0)), 0) AS today_loss
       FROM inventory_movements m
      WHERE m.movement_type = 'spoilage'
        AND m.order_id IS NULL
        AND m.waste_reason IS NOT NULL
        AND m.reversed_by_movement_id IS NULL
        AND m.created_at >= ?
        AND m.created_at <= ?`,
    [`${todayManila} 00:00:00`, `${todayManila} 23:59:59`],
  );

  let topWastedItems = [];
  if (includeCost) {
    const [topRows] = await pool.query(
      `SELECT m.inventory_item_id AS item_id,
              COALESCE(ii.name, m.item_name_snapshot) AS item_name,
              COALESCE(m.unit, ii.unit) AS unit,
              COALESCE(SUM(ABS(m.quantity_change)), 0) AS total_qty,
              COALESCE(SUM(COALESCE(m.batch_cost, 0)), 0) AS total_value,
              COUNT(*) AS event_count
         FROM inventory_movements m
         LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
        WHERE m.movement_type = 'spoilage'
          AND m.order_id IS NULL
          AND m.waste_reason IS NOT NULL
          AND m.reversed_by_movement_id IS NULL
          AND m.created_at >= ?
          AND m.created_at <= ?
        GROUP BY m.inventory_item_id, item_name, COALESCE(m.unit, ii.unit)
        ORDER BY total_value DESC, total_qty DESC
        LIMIT 5`,
      [`${todayManila} 00:00:00`, `${todayManila} 23:59:59`],
    );
    topWastedItems = topRows.map((row) => ({
      itemId: Number(row.item_id),
      itemName: row.item_name || "Unknown Item",
      unit: row.unit || null,
      totalDeductedQuantity: round6(row.total_qty),
      totalWasteValue: round2(row.total_value),
      eventCount: Number(row.event_count || 0),
    }));
  }

  response.json({
    items: rows.map((row) => formatWasteResponseRow(row, includeCost)),
    total: Number(countRow?.total || 0),
    page,
    limit,
    totalWasteEventsToday: Number(todaySummary?.today_events || 0),
    ...(includeCost ? {
      totalWasteLossToday: round2(todaySummary?.today_loss || 0),
      topWastedItems,
    } : {}),
  });
});

router.post("/waste-logs/:movementId/reverse", requireAuth, requireRole("admin"), async (request, response) => {
  response.json(await reverseDeductionMovement(request, "spoilage"));
});

router.post("/internal-use/:movementId/reverse", requireAuth, requireRole("admin"), async (request, response) => {
  response.json(await reverseDeductionMovement(request, "internal_use"));
});

router.post("/:id/waste", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw httpError(400, "Invalid inventory ID.");
  }
  const cleanClientRequestId = parseOptionalClientRequestId(request.body?.clientRequestId);
  const result = await executeLogWaste({
    id,
    authUser: request.authUser,
    body: request.body || {},
    cleanClientRequestId,
  });
  return response.status(result.status).json(result.body);
});

router.get("/:id/movements", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid inventory ID.");
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit, 10) || 30));
  const [[item]] = await pool.execute("SELECT id FROM inventory_items WHERE id = ?", [id]);
  if (!item) throw httpError(404, "Inventory item not found.");
  const includeCost = request.authUser.role === "admin";
  const [rows] = await pool.query(
    `SELECT m.*,
            COALESCE(ii.name, m.item_name_snapshot) AS item_name,
            ii.unit AS current_item_unit,
            COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name,
            o.order_number
       FROM inventory_movements m
       LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN orders o ON o.id = m.order_id
      WHERE m.inventory_item_id = ?
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ?`,
    [id, limit],
  );
  response.json(rows.map((row) => mapMovementRow(row, includeCost)));
});

router.post("/", requireAuth, requireRole("admin"), async (request, response) => {
  const { item, category, unit, image } = request.body || {};
  const name = String(item || "").trim();
  const cleanCategory = String(category || "Supplies").trim();
  const cleanUnit = String(unit || "pcs").trim();
  const imageUrl = validateImageUrl(image ?? null, { label: "Inventory image" });
  const quantity = Number(request.body.quantity || 0);
  const maximumStock = request.body.maximumStock == null || request.body.maximumStock === "" ? null : Number(request.body.maximumStock);
  const supplierName = String(request.body?.supplierName || "").trim().slice(0, 120) || null;
  const referenceNo = String(request.body?.referenceNo || "").trim().slice(0, 80) || null;
  const cleanClientRequestId = parseOptionalClientRequestId(request.body?.clientRequestId);
  const packedUnitError = unitWithAmountError(cleanUnit);
  if (packedUnitError) throw httpError(400, packedUnitError);
  if (!name || name.length > 160 || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock <= 0))) {
    throw httpError(400, "Enter a valid inventory name, category, unit, and quantity. Maximum stock must be above zero or omitted.");
  }
  if (isWholeNumberUnit(cleanUnit) && [quantity, maximumStock].some((value) => value !== null && !Number.isInteger(value))) {
    throw httpError(400, "Items counted in pieces, cans or pairs must be whole numbers. Use a whole number for the stock amounts.");
  }
  const { purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost } = resolveCosting(request.body);
  if (isWholeNumberUnit(cleanUnit) && !Number.isInteger(contentsPerPackage)) {
    throw httpError(400, "The amount in each pack must be a whole number when the item is counted in pieces, cans or pairs.");
  }
  // Blank maximum on create falls back to the starting quantity (only when there is stock).
  const effectiveMaximumStock = maximumStock === null && quantity > 0 ? quantity : maximumStock;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";

  const assertCreateReplayMatches = (existing) => {
    if (
      Boolean(existing.is_archived) ||
      String(existing.name || "").trim().toLowerCase() !== name.toLowerCase() ||
      String(existing.category || "").trim().toLowerCase() !== cleanCategory.toLowerCase() ||
      String(existing.unit || "").trim().toLowerCase() !== cleanUnit.toLowerCase()
    ) {
      throw httpError(409, "Client request ID was already used for a different inventory item.");
    }
  };

  if (cleanClientRequestId) {
    const [[existingItem]] = await pool.execute(
      "SELECT id, name, category, unit, is_archived FROM inventory_items WHERE client_request_id = ? LIMIT 1",
      [cleanClientRequestId],
    );
    if (existingItem) {
      assertCreateReplayMatches(existingItem);
      return response.status(200).json(await fetchMappedItemById(existingItem.id, true));
    }
  }

  const connection = await pool.getConnection();
  let createdId;
  let txOpen = false;
  try {
    await connection.beginTransaction();
    txOpen = true;
    const sessionId = await resolveActiveSessionId(connection, request.authUser.sub, {
      explicitSessionId: request.body?.sessionId ?? null,
    });
    const isCupCategoryHint = /^cups?(\s*&\s*lids)?$/i.test(cleanCategory) ? 1 : 0;
    await connection.execute(
      `INSERT IGNORE INTO inventory_categories (name, description, is_cup_category, is_system, display_order, is_active)
       VALUES (?, NULL, ?, FALSE, 99, TRUE)`,
      [cleanCategory, isCupCategoryHint],
    );
    const [created] = await connection.execute(
      `INSERT INTO inventory_items (
         name, image_url, category, quantity, unit, maximum_stock,
         purchase_price, package_quantity, package_unit, contents_per_package, unit_cost, client_request_id
       ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, imageUrl, cleanCategory, cleanUnit, effectiveMaximumStock, purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost, cleanClientRequestId],
    );
    createdId = created.insertId;
    await syncCupRow(connection, createdId, cleanCategory, name);
    if (quantity > 0) {
      await connection.execute("UPDATE inventory_items SET quantity = ? WHERE id = ?", [quantity, createdId]);
      const openingValue = Number((quantity * unitCost).toFixed(2));
      const openingBatchCost = openingValue > 0
        ? openingValue
        : (purchasePrice > 0 ? Number(purchasePrice.toFixed(2)) : null);
      const [openMove] = await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           batch_cost, unit_cost_before, unit_cost_after, supplier_name, reference_no, session_id
         ) VALUES (?, ?, 'restock', ?, 'Opening stock', ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [
          createdId,
          request.authUser.sub,
          quantity,
          name,
          actorName,
          quantity,
          cleanUnit,
          openingBatchCost,
          unitCost,
          supplierName,
          referenceNo,
          sessionId,
        ],
      );
      if (openingValue >= 0.01) {
        await postInventoryValuationDelta(connection, {
          inventoryMovementId: openMove.insertId,
          itemName: name,
          deltaValue: openingValue,
          entryType: "opening_balance",
          offsetAccountCode: "3010",
          memo: `Opening stock: ${name} (+${quantity} ${cleanUnit} @ ₱${unitCost.toFixed(2)})`,
          referenceNumber: referenceNo,
          sessionId,
          userId: request.authUser.sub,
        });
      }
    }
    await connection.commit();
    txOpen = false;
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    if (error.code === "ER_DUP_ENTRY" && cleanClientRequestId) {
      const [[existingItem]] = await pool.execute(
        "SELECT id, name, category, unit, is_archived FROM inventory_items WHERE client_request_id = ? LIMIT 1",
        [cleanClientRequestId],
      );
      if (existingItem) {
        assertCreateReplayMatches(existingItem);
        return response.status(200).json(await fetchMappedItemById(existingItem.id, true));
      }
    }
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "An inventory item with that name already exists (check active inventory or the 30-day Archive).");
    throw error;
  } finally {
    connection.release();
  }
  response.status(201).json(await fetchMappedItemById(createdId, true));
});

router.put("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  const { item, category, unit, image } = request.body || {};
  const name = String(item || "").trim();
  const cleanCategory = String(category || "").trim();
  const cleanUnit = String(unit || "").trim();
  const imageUrl = validateImageUrl(image);
  const quantity = Number(request.body.quantity);
  const maximumStock = request.body.maximumStock == null || request.body.maximumStock === "" ? null : Number(request.body.maximumStock);
  const supplierName = String(request.body?.supplierName || "").trim().slice(0, 120) || null;
  const referenceNo = String(request.body?.referenceNo || "").trim().slice(0, 80) || null;
  const packedUnitError = unitWithAmountError(cleanUnit);
  if (packedUnitError) throw httpError(400, packedUnitError);
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock <= 0))) {
    throw httpError(400, "Enter valid inventory values. Maximum stock must be above zero or omitted.");
  }
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";
  let unitDimensionWarning = null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[current]] = await connection.execute("SELECT * FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE", [id]);
    if (!current) throw httpError(404, "Inventory item not found.");
    const [[activeSession]] = await connection.execute(
      "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
      [request.authUser.sub],
    );
    const sessionId = activeSession ? Number(activeSession.id) : null;
    // A unit change cascades to menu recipes/add-ons within the same transaction, scaling same-dimension quantities.
    if (String(current.unit).trim().toLowerCase() !== cleanUnit.toLowerCase()) {
      const oldDim = getUnitDimension(current.unit);
      const newDim = getUnitDimension(cleanUnit);
      const changed = await retargetRecipeUnits(connection, id, current.unit, cleanUnit);
      if (changed > 0 && oldDim && newDim && oldDim !== newDim) {
        unitDimensionWarning = `Unit dimension changed (${oldDim} → ${newDim}) across ${changed} recipe row(s). Verify recipe portion amounts.`;
      }
    }

    if (isWholeNumberUnit(cleanUnit) && [quantity, maximumStock].some((value) => value !== null && !Number.isInteger(value))) {
      throw httpError(400, "Items counted in pieces, cans or pairs must be whole numbers. Use a whole number for the stock amounts.");
    }
    const { purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost } = resolveCosting(request.body, current);
    if (isWholeNumberUnit(cleanUnit) && !Number.isInteger(contentsPerPackage)) {
      throw httpError(400, "The amount in each pack must be a whole number when the item is counted in pieces, cans or pairs.");
    }
    const isSelfMediaProxyUrl = typeof imageUrl === "string" && imageUrl.startsWith(`/api/media/inventory/${id}`);
    const effectiveImage = isSelfMediaProxyUrl
      ? current.image_url
      : (imageUrl !== undefined ? imageUrl : current.image_url);

    const isCupCategoryHint = /^cups?(\s*&\s*lids)?$/i.test(cleanCategory) ? 1 : 0;
    await connection.execute(
      `INSERT IGNORE INTO inventory_categories (name, description, is_cup_category, is_system, display_order, is_active)
       VALUES (?, NULL, ?, FALSE, 99, TRUE)`,
      [cleanCategory, isCupCategoryHint],
    );
    await connection.execute(
      `UPDATE inventory_items SET
         name = ?, image_url = ?, category = ?, quantity = ?, unit = ?, maximum_stock = ?,
         purchase_price = ?, package_quantity = ?, package_unit = ?, contents_per_package = ?, unit_cost = ?
       WHERE id = ?`,
      [name, effectiveImage, cleanCategory, quantity, cleanUnit, maximumStock, purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost, id],
    );
    await syncCupRow(connection, id, cleanCategory, name);
    const oldQty = Number(current.quantity || 0);
    const oldUnitCost = Number(current.unit_cost || 0);
    const delta = Math.round((quantity - oldQty) * 1000000) / 1000000;
    const costChanged = Math.abs(unitCost - oldUnitCost) > 1e-6;
    const adjOffsetAccount = ["6031", "6030", "3010", "6010"].includes(String(request.body?.adjustmentAccountCode || "").trim())
      ? String(request.body.adjustmentAccountCode).trim()
      : null;
    if (delta !== 0 || costChanged) {
      const note = delta !== 0
        ? (costChanged ? "Manual stock & cost adjustment" : "Manual inventory adjustment")
        : "Manual unit cost adjustment";
      const [adjMove] = await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           unit_cost_before, unit_cost_after, supplier_name, reference_no, session_id
         ) VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          request.authUser.sub,
          delta,
          note,
          name,
          actorName,
          oldQty,
          quantity,
          cleanUnit,
          oldUnitCost,
          unitCost,
          supplierName,
          referenceNo,
          sessionId,
        ],
      );
      const valuationDelta = Number(((quantity * unitCost) - (oldQty * oldUnitCost)).toFixed(2));
      if (Math.abs(valuationDelta) >= 0.01) {
        await postInventoryValuationDelta(connection, {
          inventoryMovementId: adjMove.insertId,
          itemName: name,
          deltaValue: valuationDelta,
          entryType: "adjustment",
          offsetAccountCode: adjOffsetAccount,
          memo: `${note}: ${name} (val delta ${valuationDelta >= 0 ? "+" : ""}₱${valuationDelta.toFixed(2)})`,
          referenceNumber: referenceNo,
          sessionId,
          userId: request.authUser.sub,
        });
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "An inventory item with that name already exists.");
    throw error;
  } finally {
    connection.release();
  }
  const payload = await fetchMappedItemById(id, true);
  if (unitDimensionWarning) payload.unitDimensionWarning = unitDimensionWarning;
  response.json(payload);
});

const ALLOWED_RESTOCK_ACCOUNTS = new Set(["1010", "1020", "1030", "1040", "2010", "3010"]);

router.post("/:id/restock", requireAuth, requireRole("admin"), async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "inventory ID");
  const quantity = Number(request.body?.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw httpError(400, "Restock quantity must be greater than zero.");

  const rawBatchCost = request.body?.batchCost;
  const hasBatchCost = rawBatchCost !== undefined && rawBatchCost !== null && String(rawBatchCost).trim() !== "";
  const parsedBatchCost = hasBatchCost ? parseExactMoney(rawBatchCost, "Batch cost", { allowZero: true }) : 0;
  const diluteZeroCost = Boolean(request.body?.diluteZeroCost);
  const rawCreditAccount = String(request.body?.creditAccountCode || "1010").trim();
  if (!ALLOWED_RESTOCK_ACCOUNTS.has(rawCreditAccount)) {
    throw httpError(400, "Choose how the restock was paid: cash drawer, GCash, store bank, owner reserve, unpaid supplier bill, or new money from the owner.");
  }
  const supplierName = String(request.body?.supplierName || "").trim().slice(0, 120) || null;
  const referenceNo = String(request.body?.referenceNo || "").trim().slice(0, 80) || null;
  const cleanClientRequestId = parseOptionalClientRequestId(request.body?.clientRequestId);
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";

  const assertRestockReplayMatches = (existingMove) => {
    if (
      Number(existingMove.inventory_item_id) !== id ||
      existingMove.movement_type !== "restock" ||
      round6(Math.abs(Number(existingMove.quantity_change || 0))) !== round6(quantity)
    ) {
      throw httpError(409, "Client request ID was already used for a different inventory movement.");
    }
  };

  if (cleanClientRequestId) {
    const existingMove = await findExistingWasteByClientRequest(
      pool,
      request.authUser.sub,
      cleanClientRequestId,
    );
    if (existingMove) {
      assertRestockReplayMatches(existingMove);
      return response.status(200).json(await fetchMappedItemById(id, true));
    }
  }

  const connection = await pool.getConnection();
  let txOpen = false;
  try {
    await connection.beginTransaction();
    txOpen = true;
    const [[current]] = await connection.execute("SELECT * FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE", [id]);
    if (!current) throw httpError(404, "Inventory item not found.");
    const sessionId = await resolveActiveSessionId(connection, request.authUser.sub, {
      explicitSessionId: request.body?.sessionId ?? null,
    });
    const beforeQuantity = Number(current.quantity || 0);
    const afterQuantity = Math.round((beforeQuantity + quantity) * 1000000) / 1000000;
    const oldCost = Number(current.unit_cost || 0);
    if (oldCost > 0 && (!hasBatchCost || (parsedBatchCost === 0 && !diluteZeroCost))) {
      throw httpError(
        400,
        "Batch cost greater than zero is required when restocking an item with existing unit cost (or set diluteZeroCost: true for a zero-cost bonus batch) so Account 1050 stays synchronized.",
      );
    }
    let restockMoveId = null;

    if (hasBatchCost && (parsedBatchCost > 0 || (parsedBatchCost === 0 && diluteZeroCost))) {
      const oldQty = Math.max(0, beforeQuantity);
      const oldCostPositive = Math.max(0, oldCost);
      const batchUnitCost = parsedBatchCost / quantity;
      const rawNewUnitCost = oldQty > 0
        ? ((oldQty * oldCostPositive) + parsedBatchCost) / (oldQty + quantity)
        : batchUnitCost;
      const newUnitCost = Number(rawNewUnitCost.toFixed(6));
      await connection.execute(
        "UPDATE inventory_items SET quantity = quantity + ?, unit_cost = ? WHERE id = ? AND is_archived = FALSE",
        [quantity, newUnitCost, id],
      );
      const formattedAvg = Number(newUnitCost.toFixed(3)).toFixed(newUnitCost.toFixed(3).endsWith("0") ? 2 : 3);
      const note = `Inventory restock (+${quantity} ${current.unit} for ₱${parsedBatchCost.toFixed(2)} · new avg ₱${formattedAvg}/${current.unit})`;
      const [moveRes] = await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           batch_cost, unit_cost_before, unit_cost_after, supplier_name, reference_no, session_id, client_request_id
         ) VALUES (?, ?, 'restock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          request.authUser.sub,
          quantity,
          note,
          current.name,
          actorName,
          beforeQuantity,
          afterQuantity,
          current.unit,
          Number(parsedBatchCost.toFixed(2)),
          oldCost,
          newUnitCost,
          supplierName,
          referenceNo,
          sessionId,
          cleanClientRequestId,
        ],
      );
      restockMoveId = moveRes.insertId;
    } else {
      await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ? AND is_archived = FALSE", [quantity, id]);
      const [moveRes] = await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           batch_cost, unit_cost_before, unit_cost_after, supplier_name, reference_no, session_id, client_request_id
         ) VALUES (?, ?, 'restock', ?, 'Inventory restock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          request.authUser.sub,
          quantity,
          current.name,
          actorName,
          beforeQuantity,
          afterQuantity,
          current.unit,
          hasBatchCost ? 0 : null,
          oldCost,
          oldCost,
          supplierName,
          referenceNo,
          sessionId,
          cleanClientRequestId,
        ],
      );
      restockMoveId = moveRes.insertId;
    }
    // Automated double-entry posting for inventory restock
    if (hasBatchCost && parsedBatchCost > 0) {
      const cleanCost = Number(parsedBatchCost.toFixed(2));
      const restockLedgerRes = await postBalancedEntry(connection, {
        entryType: "inventory_restock",
        memo: `Restock ${current.name}: +${quantity} ${current.unit} (batch cost ₱${cleanCost.toFixed(2)} via ${rawCreditAccount})`,
        referenceNumber: referenceNo ? String(referenceNo).slice(0, 100) : null,
        inventoryMovementId: restockMoveId,
        sessionId,
        idempotencyKey: restockMoveId ? `inv_move:${restockMoveId}:inventory_restock` : null,
        createdBy: request.authUser.sub,
        lines: [
          { accountCode: "1050", debit: cleanCost, credit: 0, lineMemo: `Debit 1050 Restock ${current.name}` },
          { accountCode: rawCreditAccount, debit: 0, credit: cleanCost, lineMemo: `Credit ${rawCreditAccount} for ${current.name}` },
        ],
      });
      if (rawCreditAccount === "2010" && restockLedgerRes?.entryId && !restockLedgerRes.skipped) {
        const billNumber = `RST-${restockLedgerRes.entryId}`;
        await connection.execute(
          `INSERT INTO financial_payables (
             bill_number, bill_category, vendor_name, expense_account_code, liability_account_code,
             bill_date, due_date, original_amount, paid_amount, status, incurred_journal_entry_id,
             session_id, notes, created_by
           ) VALUES (?, 'inventory_restock', ?, '1050', '2010', ?, NULL, ?, 0.00, 'unpaid', ?, ?, ?, ?)`,
          [
            billNumber,
            supplierName,
            getManilaDateString(),
            cleanCost,
            restockLedgerRes.entryId,
            sessionId,
            `Restock ${current.name} (+${quantity} ${current.unit})${referenceNo ? ` · Ref: ${referenceNo}` : ""}`.slice(0, 500),
            request.authUser.sub,
          ],
        );
      }
    }

    // First restock of an item that has no maximum and no stock (e.g. auto-created from a menu
    // recipe at 0): use the restocked amount as the maximum. Never touches a maximum that is set.
    if (current.maximum_stock == null && Number(current.quantity || 0) <= 0) {
      await connection.execute("UPDATE inventory_items SET maximum_stock = ? WHERE id = ? AND maximum_stock IS NULL", [quantity, id]);
    }
    await connection.commit();
    txOpen = false;
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    if (error.code === "ER_DUP_ENTRY" && cleanClientRequestId) {
      const existingMove = await findExistingWasteByClientRequest(
        pool,
        request.authUser.sub,
        cleanClientRequestId,
      );
      if (existingMove) {
        assertRestockReplayMatches(existingMove);
        return response.status(200).json(await fetchMappedItemById(id, true));
      }
    }
    throw error;
  } finally {
    connection.release();
  }
  const payload = await fetchMappedItemById(id, true);
  response.json(payload);
});

router.post("/:id/internal-use", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw httpError(400, "Invalid inventory ID.");
  }

  const parsedQty = parseStrictFiniteNumber(request.body?.quantity);
  if (parsedQty === null || parsedQty <= 0) {
    throw httpError(400, "Internal store use quantity must be a finite number greater than zero.");
  }
  const deductQty = round6(parsedQty);
  if (deductQty <= 0) {
    throw httpError(400, "Internal store use quantity must be greater than zero.");
  }

  const expenseAccountCode = String(request.body?.expenseAccountCode || "").trim();
  if (!ALLOWED_INTERNAL_USE_ACCOUNTS.has(expenseAccountCode)) {
    throw httpError(
      400,
      "Invalid expenseAccountCode. Allowed OPEX accounts: 6113, 6130, 6133, 6140, 6141, 6142, 6143, 6144.",
    );
  }

  const cleanNote = String(request.body?.note || "").trim().slice(0, 420);
  const cleanClientRequestId = parseOptionalClientRequestId(request.body?.clientRequestId);
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";
  const movementNote = (
    cleanNote
      ? `Internal store use (${expenseAccountCode}): ${cleanNote}`
      : `Internal store use (${expenseAccountCode})`
  ).slice(0, 500);

  const [[expenseCoa]] = await pool.execute(
    "SELECT id, report_section, is_active FROM chart_of_accounts WHERE account_code = ? LIMIT 1",
    [expenseAccountCode],
  );
  if (!expenseCoa || !expenseCoa.is_active || expenseCoa.report_section !== "opex") {
    throw httpError(400, `Expense account '${expenseAccountCode}' is inactive or not classified under OPEX.`);
  }

  if (cleanClientRequestId) {
    const existingMove = await findExistingWasteByClientRequest(
      pool,
      request.authUser.sub,
      cleanClientRequestId,
    );
    if (existingMove) {
      assertInternalUseReplayMatches(existingMove, id, deductQty, expenseAccountCode, movementNote);
      return response.status(200).json(formatInternalUseResponseRow(existingMove, expenseAccountCode));
    }
  }

  const connection = await pool.getConnection();
  let movementId;
  let ledgerRes;
  let usageValue;
  let txOpen = false;

  try {
    await connection.beginTransaction();
    txOpen = true;

    const [[current]] = await connection.execute(
      "SELECT * FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE",
      [id],
    );
    if (!current) {
      throw httpError(404, "Inventory item not found.");
    }

    const beforeQuantity = round6(Number(current.quantity || 0));
    if (deductQty > beforeQuantity) {
      // Roll back before re-checking client_request_id so REPEATABLE READ sees a concurrent winner.
      await connection.rollback();
      txOpen = false;
      if (cleanClientRequestId) {
        const raceExisting = await findExistingWasteByClientRequest(
          connection,
          request.authUser.sub,
          cleanClientRequestId,
        );
        if (raceExisting) {
          assertInternalUseReplayMatches(raceExisting, id, deductQty, expenseAccountCode, movementNote);
          return response.status(200).json(formatInternalUseResponseRow(raceExisting, expenseAccountCode));
        }
      }
      throw httpError(
        409,
        `Cannot use ${deductQty} ${current.unit} of ${current.name}; only ${beforeQuantity} ${current.unit} in stock.`,
      );
    }
    const afterQuantity = round6(beforeQuantity - deductQty);

    const sessionId = await resolveActiveSessionId(connection, request.authUser.sub, {
      explicitSessionId: request.body?.sessionId ?? null,
    });

    await connection.execute(
      "UPDATE inventory_items SET quantity = ? WHERE id = ? AND is_archived = FALSE",
      [afterQuantity, id],
    );

    const unitCost = Number(current.unit_cost || 0);
    usageValue = round2(deductQty * unitCost);

    try {
      const [moveRes] = await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           batch_cost, unit_cost_before, unit_cost_after, session_id, client_request_id
         ) VALUES (?, ?, 'internal_use', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          request.authUser.sub,
          -deductQty,
          movementNote,
          current.name,
          actorName,
          beforeQuantity,
          afterQuantity,
          current.unit,
          usageValue,
          unitCost,
          unitCost,
          sessionId,
          cleanClientRequestId,
        ],
      );
      movementId = Number(moveRes.insertId);
    } catch (insertError) {
      if (cleanClientRequestId && insertError?.code === "ER_DUP_ENTRY") {
        await connection.rollback();
        txOpen = false;
        const raceExisting = await findExistingWasteByClientRequest(
          connection,
          request.authUser.sub,
          cleanClientRequestId,
        );
        if (raceExisting) {
          assertInternalUseReplayMatches(raceExisting, id, deductQty, expenseAccountCode, movementNote);
          return response.status(200).json(formatInternalUseResponseRow(raceExisting, expenseAccountCode));
        }
      }
      throw insertError;
    }

    ledgerRes = await postInventoryValuationDelta(connection, {
      inventoryMovementId: movementId,
      itemName: current.name,
      deltaValue: -usageValue,
      entryType: "operating_expense",
      offsetAccountCode: expenseAccountCode,
      memo: `Internal store use (${expenseAccountCode}): ${current.name} (-${deductQty} ${current.unit})${cleanNote ? ` · ${cleanNote}` : ""}`,
      referenceNumber: `USE-${movementId}`,
      sessionId,
      userId: request.authUser.sub,
    });

    await connection.commit();
    txOpen = false;
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }

  const [[createdRow]] = await pool.execute(
    `SELECT m.*,
            COALESCE(ii.name, m.item_name_snapshot) AS item_name,
            ii.unit AS current_item_unit,
            COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name
       FROM inventory_movements m
       LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.id = ?
      LIMIT 1`,
    [movementId],
  );

  response.status(201).json({
    ...mapMovementRow(createdRow, true),
    movementId,
    usageValue,
    expenseAccountCode,
    journalEntryId: ledgerRes?.entryId ?? null,
  });
});

router.delete("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid inventory ID.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.execute(
      "SELECT id, name, category, quantity, unit FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE",
      [id],
    );
    if (!existing) throw httpError(404, "Inventory item not found.");
    if (Number(existing.quantity || 0) > 0) {
      throw httpError(
        409,
        `Cannot archive "${existing.name}" while ${Number(existing.quantity)} ${existing.unit} remain in stock. Deduct remaining stock via Waste / Store Use or adjust quantity to 0 first so Account 1050 stays synchronized.`,
      );
    }
    const [linkedRows] = await connection.execute(
      `SELECT DISTINCT mp.name FROM menu_products mp
         JOIN product_ingredients pi ON pi.product_id = mp.id WHERE pi.inventory_item_id = ? AND mp.is_archived = FALSE
       UNION
       SELECT DISTINCT mp.name FROM menu_products mp
         JOIN product_sizes ps ON ps.product_id = mp.id
         JOIN product_size_ingredients psi ON psi.product_size_id = ps.id WHERE psi.inventory_item_id = ? AND mp.is_archived = FALSE
       UNION
       SELECT DISTINCT mp.name FROM menu_products mp
         JOIN product_addons pa ON pa.product_id = mp.id WHERE pa.inventory_item_id = ? AND mp.is_archived = FALSE`,
      [id, id, id],
    );
    if (linkedRows.length > 0) {
      const productNames = linkedRows.map((row) => row.name).join(", ");
      throw httpError(409, `This inventory item is used in recipes/add-ons for active menu item(s): ${productNames}. Archive or remove it from those menu items first.`);
    }
    await connection.execute(
      "UPDATE inventory_items SET is_archived = TRUE, archived_at = NOW(), archived_by = ? WHERE id = ?",
      [request.authUser?.sub || null, id],
    );
    await recordArchiveAudit(connection, {
      entityType: "inventory_item",
      entityId: id,
      entityName: existing.name,
      action: "archived",
      actorId: request.authUser?.sub || null,
      actorName: request.authUser?.displayName || request.authUser?.username || "Admin",
      note: `Archived with ${Number(existing.quantity)} ${existing.unit} remaining`,
    });
    await connection.commit();
    response.status(204).end();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

export default router;
