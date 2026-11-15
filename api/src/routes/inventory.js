import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { recordArchiveAudit } from "./archive.js";
import { retargetRecipeUnits } from "../utils/recipeUnitSync.js";
import { getUnitDimension } from "../utils/inventoryUnits.js";
import {
  generateEntryNumber,
  getManilaDateString,
  postBalancedEntry,
  postInventoryValuationDelta,
} from "../utils/ledgerService.js";
import {
  computeWasteDeduction,
  normalizeWasteUnit,
  parseStrictFiniteNumber,
  round2,
  round6,
  WASTE_REASON_MAP,
  WASTE_REASON_VALUES,
} from "../utils/wasteMeasurement.js";

const router = Router();
const mapItem = (row, includeCost = true) => {
  const quantity = Number(row.quantity || 0);
  const unitCost = Number(row.unit_cost || 0);
  const purchasePrice = Number(row.purchase_price || 0);
  const packageQuantity = Number(row.package_quantity || 1);
  const contentsPerPackage = Number(row.contents_per_package || 1);
  return {
    id: Number(row.id),
    item: row.name,
    image: row.image_url || "",
    category: row.category,
    quantity,
    unit: row.unit,
    maximumStock: row.maximum_stock == null ? null : Number(row.maximum_stock),
    addedFromMenu: Boolean(row.added_from_menu),
    packageUnit: row.package_unit || "pack",
    contentsPerPackage,
    ...(includeCost ? {
      purchasePrice,
      packageQuantity,
      unitCost,
      inventoryValue: Number((quantity * unitCost).toFixed(2)),
    } : {}),
    lastUpdated: new Date(row.updated_at).toISOString(),
    isCupCategory: Boolean(row.is_cup_category) || row.category === "Cups" || row.category === "Cups & Lids",
  };
};

const validateImageUrl = (rawImage) => {
  if (rawImage === undefined) return undefined;
  if (rawImage == null || rawImage === "") return null;
  const image = String(rawImage);
  if (image.length > 8_000_000) {
    throw httpError(413, "Inventory image is too large. Choose an image under 5 MB.");
  }
  if (/^data:image\/svg\+xml/i.test(image)) {
    throw httpError(400, "SVG image uploads are not permitted. Use PNG, JPG, WEBP, or GIF.");
  }
  if (!/^(data:image\/(png|jpe?g|webp|gif);base64,|https?:\/\/|\/)/i.test(image)) {
    throw httpError(400, "Inventory image must be a PNG, JPG, WEBP, or GIF upload or a valid image URL.");
  }
  return image;
};

const unitWithAmountError = (unit) => {
  const match = String(unit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
  return match
    ? `Keep amount and unit separate. Enter ${match[1]} in the stock quantity field and “${match[2]}” as the unit (for example, quantity 5 and unit kg).`
    : null;
};

const resolveCosting = (body = {}, current = null) => {
  const isUpdate = Boolean(current);
  const rawPurchasePrice = body.purchasePrice !== undefined ? body.purchasePrice : (current?.purchase_price ?? 0);
  const purchasePrice = rawPurchasePrice === "" || rawPurchasePrice == null ? 0 : Number(rawPurchasePrice);
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    throw httpError(400, "Purchase price must be zero or greater.");
  }

  const rawPkgQty = body.packageQuantity !== undefined ? body.packageQuantity : current?.package_quantity;
  const rawContents = body.contentsPerPackage !== undefined ? body.contentsPerPackage : current?.contents_per_package;
  const parsedPkgQty = rawPkgQty === "" || rawPkgQty == null ? (isUpdate ? Number(current.package_quantity || 1) : 0) : Number(rawPkgQty);
  const parsedContents = rawContents === "" || rawContents == null ? (isUpdate ? Number(current.contents_per_package || 1) : 0) : Number(rawContents);

  if (purchasePrice > 0 && (!Number.isFinite(parsedPkgQty) || parsedPkgQty <= 0 || !Number.isFinite(parsedContents) || parsedContents <= 0)) {
    throw httpError(400, "Enter a package quantity and the measurable contents per package to calculate unit cost.");
  }

  const packageQuantity = Number.isFinite(parsedPkgQty) && parsedPkgQty > 0 ? parsedPkgQty : 1;
  const contentsPerPackage = Number.isFinite(parsedContents) && parsedContents > 0 ? parsedContents : 1;
  const packageUnit = String(body.packageUnit || current?.package_unit || "pack").trim().slice(0, 40) || "pack";

  let unitCost;
  if (!isUpdate) {
    unitCost = purchasePrice > 0
      ? Number((purchasePrice / (packageQuantity * contentsPerPackage)).toFixed(6))
      : 0;
  } else {
    const costInputsChanged =
      Math.abs(purchasePrice - Number(current.purchase_price || 0)) > 1e-6 ||
      Math.abs(packageQuantity - Number(current.package_quantity || 1)) > 1e-6 ||
      Math.abs(contentsPerPackage - Number(current.contents_per_package || 1)) > 1e-6;
    if (costInputsChanged) {
      unitCost = purchasePrice > 0
        ? Number((purchasePrice / (packageQuantity * contentsPerPackage)).toFixed(6))
        : 0;
    } else {
      unitCost = Number(current.unit_cost || 0);
    }
  }

  return { purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost };
};

// Keep inventory_cups in step with cup categories: cups get a row, anything else loses it.
const syncCupRow = async (connection, itemId, category, name) => {
  let isCupCategory;
  try {
    const [[catRow]] = await connection.execute(
      "SELECT is_cup_category FROM inventory_categories WHERE name = ? LIMIT 1",
      [category],
    );
    isCupCategory = catRow
      ? Boolean(catRow.is_cup_category)
      : (category === "Cups" || category === "Cups & Lids");
  } catch {
    isCupCategory = category === "Cups" || category === "Cups & Lids";
  }

  if (!isCupCategory) {
    await connection.execute("DELETE FROM inventory_cups WHERE inventory_item_id = ?", [itemId]);
    return;
  }
  const oz = String(name).match(/(\d+(?:\.\d+)?)\s*oz/i);
  await connection.execute(
    "INSERT INTO inventory_cups (inventory_item_id, cup_size_oz) VALUES (?, ?) ON DUPLICATE KEY UPDATE cup_size_oz = VALUES(cup_size_oz)",
    [itemId, oz ? Number(oz[1]) : null],
  );
};

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

const VALID_MOVEMENT_TYPES = new Set(["restock", "adjustment", "usage", "spoilage", "void_restore"]);

function isValidIsoDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

async function fetchMappedItemById(id, includeCost = true) {
  const [[row]] = await pool.execute(
    `SELECT ii.*, COALESCE(ic.is_cup_category, FALSE) AS is_cup_category
       FROM inventory_items ii
       LEFT JOIN inventory_categories ic ON LOWER(ii.category) COLLATE utf8mb4_unicode_ci = LOWER(ic.name) COLLATE utf8mb4_unicode_ci
      WHERE ii.id = ?
      LIMIT 1`,
    [id],
  );
  return row ? mapItem(row, includeCost) : null;
}

function stripCostFromNote(noteText) {
  if (!noteText) return "";
  return String(noteText)
    .replace(/ for ₱[0-9.,]+ · new avg ₱[0-9.,]+\/[^)]+/gi, "")
    .replace(/\s*\([^)]*₱[^)]*\)/g, "")
    .replace(/₱\s*[0-9.,]+/g, "")
    .trim();
}

function mapMovementRow(row, includeCost = true) {
  return {
    id: Number(row.id),
    itemId: Number(row.inventory_item_id),
    itemName: row.item_name || row.item_name_snapshot || "Unknown Item",
    type: row.movement_type,
    quantityChange: Number(row.quantity_change),
    beforeQuantity: row.before_quantity == null ? null : Number(row.before_quantity),
    afterQuantity: row.after_quantity == null ? null : Number(row.after_quantity),
    unit: row.unit || row.current_item_unit || null,
    ...(includeCost ? {
      batchCost: row.batch_cost == null ? null : Number(row.batch_cost),
      unitCostBefore: row.unit_cost_before == null ? null : Number(row.unit_cost_before),
      unitCostAfter: row.unit_cost_after == null ? null : Number(row.unit_cost_after),
    } : {}),
    supplierName: row.supplier_name || null,
    referenceNo: row.reference_no || null,
    orderId: row.order_id == null ? null : Number(row.order_id),
    orderNumber: row.order_number || null,
    sessionId: row.session_id == null ? null : Number(row.session_id),
    wasteReason: row.waste_reason || null,
    measurementMethod: row.measurement_method || null,
    measuredInputQty: row.measured_input_qty == null ? null : Number(row.measured_input_qty),
    measuredInputUnit: row.measured_input_unit || null,
    tareWeight: row.tare_weight == null ? null : Number(row.tare_weight),
    clientRequestId: row.client_request_id || null,
    reversedByMovementId: row.reversed_by_movement_id == null ? null : Number(row.reversed_by_movement_id),
    isReversed: Boolean(row.reversed_by_movement_id),
    note: includeCost ? (row.note || "") : stripCostFromNote(row.note || ""),
    actorId: row.user_id == null ? null : Number(row.user_id),
    actor: row.actor_name || "System",
    timestamp: new Date(row.created_at).toISOString(),
  };
}

function formatWasteResponseRow(row, includeCost = true, journalEntryId = null) {
  const deductedQuantity = round6(Math.abs(Number(row.quantity_change || 0)));
  const resolvedJeId = journalEntryId !== null && journalEntryId !== undefined
    ? Number(journalEntryId)
    : (row.journal_entry_id == null ? null : Number(row.journal_entry_id));
  return {
    id: Number(row.id),
    movementId: Number(row.id),
    itemId: Number(row.inventory_item_id),
    itemName: row.item_name || row.item_name_snapshot || "Unknown Item",
    type: row.movement_type,
    quantityChange: Number(row.quantity_change),
    deductedQuantity,
    beforeQuantity: row.before_quantity == null ? null : Number(row.before_quantity),
    afterQuantity: row.after_quantity == null ? null : Number(row.after_quantity),
    unit: row.unit || row.current_item_unit || null,
    wasteReason: row.waste_reason || null,
    measurementMethod: row.measurement_method || null,
    measuredInputQty: row.measured_input_qty == null ? null : Number(row.measured_input_qty),
    measuredInputUnit: row.measured_input_unit || null,
    tareWeight: row.tare_weight == null ? null : Number(row.tare_weight),
    clientRequestId: row.client_request_id || null,
    reversedByMovementId: row.reversed_by_movement_id == null ? null : Number(row.reversed_by_movement_id),
    isReversed: Boolean(row.reversed_by_movement_id),
    orderId: row.order_id == null ? null : Number(row.order_id),
    orderNumber: row.order_number || null,
    sessionId: row.session_id == null ? null : Number(row.session_id),
    note: includeCost ? (row.note || "") : stripCostFromNote(row.note || ""),
    actorId: row.user_id == null ? null : Number(row.user_id),
    actor: row.actor_name || "System",
    timestamp: new Date(row.created_at).toISOString(),
    ...(includeCost ? {
      wasteValue: row.batch_cost == null ? 0 : round2(row.batch_cost),
      batchCost: row.batch_cost == null ? null : round2(row.batch_cost),
      unitCostBefore: row.unit_cost_before == null ? null : Number(row.unit_cost_before),
      unitCostAfter: row.unit_cost_after == null ? null : Number(row.unit_cost_after),
      journalEntryId: resolvedJeId,
    } : {}),
  };
}

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
    const term = `%${String(search).trim().toLowerCase()}%`;
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
  const [rows] = await pool.execute(`
    SELECT ii.*, COALESCE(ic.is_cup_category, FALSE) AS is_cup_category
      FROM inventory_items ii
      LEFT JOIN inventory_categories ic ON LOWER(ii.category) COLLATE utf8mb4_unicode_ci = LOWER(ic.name) COLLATE utf8mb4_unicode_ci
     WHERE ii.is_archived = FALSE
     ORDER BY ii.category, ii.name
  `);
  response.json(rows.map((row) => mapItem(row, includeCost)));
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

const CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{16,100}$/;

async function findExistingWasteByClientRequest(executor, userId, clientRequestId) {
  const [[row]] = await executor.execute(
    `SELECT m.*,
            COALESCE(ii.name, m.item_name_snapshot) AS item_name,
            ii.unit AS current_item_unit,
            COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name,
            je.id AS journal_entry_id
       FROM inventory_movements m
       LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN journal_entries je ON je.inventory_movement_id = m.id AND je.is_reversal = FALSE
      WHERE m.user_id = ? AND m.client_request_id = ?
      LIMIT 1`,
    [userId, clientRequestId],
  );
  return row || null;
}

function assertWasteReplayMatches(existingMove, itemId, body = {}) {
  if (Number(existingMove.inventory_item_id) !== itemId) {
    throw httpError(409, "Client request ID was already used for a different inventory item.");
  }

  const incomingMethod = typeof body.measurementMethod === "string" ? body.measurementMethod.trim() : "";
  const incomingReason = typeof body.wasteReason === "string" ? body.wasteReason.trim() : "";
  const incomingNote = typeof body.note === "string" ? body.note.trim() : "";
  const incomingQty = parseStrictFiniteNumber(body.measuredQuantity);
  const incomingRoundedQty = incomingQty === null ? null : round6(incomingQty);
  const storedQty = existingMove.measured_input_qty == null ? null : round6(Number(existingMove.measured_input_qty));

  const fallbackUnit = existingMove.current_item_unit || existingMove.unit || "";
  const incomingUnit = normalizeWasteUnit(String(body.measuredUnit || fallbackUnit).trim());
  const storedUnit = normalizeWasteUnit(String(existingMove.measured_input_unit || fallbackUnit).trim());

  const hasIncomingTare =
    body.tareWeight !== null &&
    body.tareWeight !== undefined &&
    !(typeof body.tareWeight === "string" && body.tareWeight.trim() === "");
  const incomingTareNum = hasIncomingTare ? parseStrictFiniteNumber(body.tareWeight) : null;
  const incomingRoundedTare = hasIncomingTare
    ? (incomingTareNum === null ? NaN : round6(incomingTareNum))
    : null;
  const storedTare = existingMove.tare_weight == null ? null : round6(Number(existingMove.tare_weight));

  const payloadMatches =
    existingMove.measurement_method === incomingMethod &&
    existingMove.waste_reason === incomingReason &&
    String(existingMove.note || "").trim() === incomingNote &&
    incomingRoundedQty !== null &&
    storedQty === incomingRoundedQty &&
    storedUnit === incomingUnit &&
    ((storedTare === null && incomingRoundedTare === null) ||
      (storedTare !== null && Number.isFinite(incomingRoundedTare) && storedTare === incomingRoundedTare));

  if (!payloadMatches) {
    throw httpError(409, "Client request ID was already used with a different waste payload.");
  }
}

router.post("/waste-logs/:movementId/reverse", requireAuth, requireRole("admin"), async (request, response) => {
  const movementId = Number(request.params.movementId);
  if (!Number.isSafeInteger(movementId) || movementId <= 0) {
    throw httpError(400, "Invalid waste movement ID.");
  }

  const cleanReason = String(request.body?.reason || "").trim().slice(0, 255);
  if (cleanReason.length < 3) {
    throw httpError(400, "Please enter a clear reversal reason (at least 3 characters).");
  }

  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";
  const connection = await pool.getConnection();
  let responsePayload;

  try {
    await connection.beginTransaction();

    const [[orig]] = await connection.execute(
      "SELECT * FROM inventory_movements WHERE id = ? FOR UPDATE",
      [movementId],
    );
    if (!orig) {
      throw httpError(404, "Waste movement entry not found.");
    }
    if (orig.movement_type !== "spoilage") {
      throw httpError(400, "Only spoilage / waste log entries can be reversed here.");
    }
    if (orig.order_id != null || !orig.waste_reason) {
      throw httpError(400, "Only standalone zero-guesswork waste logs can be reversed here.");
    }
    if (orig.reversed_by_movement_id != null) {
      throw httpError(409, "This waste entry has already been reversed.");
    }

    const [[itemRow]] = await connection.execute(
      "SELECT * FROM inventory_items WHERE id = ? FOR UPDATE",
      [orig.inventory_item_id],
    );
    if (!itemRow) {
      throw httpError(404, "Associated inventory item not found.");
    }
    if (itemRow.is_archived) {
      throw httpError(409, "Cannot reverse waste on an archived inventory item. Restore the inventory item first.");
    }

    const restoredQuantity = round6(Math.abs(Number(orig.quantity_change || 0)));
    if (!Number.isFinite(restoredQuantity) || restoredQuantity <= 0) {
      throw httpError(400, "Waste movement has no quantity available to restore.");
    }

    const beforeQuantity = round6(Number(itemRow.quantity || 0));
    const afterQuantity = round6(beforeQuantity + restoredQuantity);
    const currentUnitCost = Number(itemRow.unit_cost || 0);
    const restoredBatchCost = orig.batch_cost == null ? null : round2(Math.abs(Number(orig.batch_cost)));
    const oldQtyPositive = Math.max(0, beforeQuantity);
    const oldCostPositive = Math.max(0, currentUnitCost);
    const restoredValue = restoredBatchCost !== null
      ? restoredBatchCost
      : round2(restoredQuantity * Math.max(0, Number(orig.unit_cost_before ?? oldCostPositive)));
    const newUnitCost = afterQuantity > 0
      ? round6(((oldQtyPositive * oldCostPositive) + restoredValue) / afterQuantity)
      : oldCostPositive;

    let [[activeSession]] = await connection.execute(
      "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
      [request.authUser.sub],
    );
    if (!activeSession) {
      [[activeSession]] = await connection.execute(
        "SELECT id FROM cashier_sessions WHERE status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
      );
    }
    const sessionId = activeSession ? Number(activeSession.id) : (orig.session_id ? Number(orig.session_id) : null);

    await connection.execute(
      "UPDATE inventory_items SET quantity = ?, unit_cost = ? WHERE id = ?",
      [afterQuantity, newUnitCost, itemRow.id],
    );

    const reversalNote = `Reversal of waste log #${orig.id}: ${cleanReason}`.slice(0, 500);
    const [revMoveRes] = await connection.execute(
      `INSERT INTO inventory_movements (
         inventory_item_id, user_id, movement_type, quantity_change, note,
         item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
         batch_cost, unit_cost_before, unit_cost_after, session_id
       ) VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemRow.id,
        request.authUser.sub,
        restoredQuantity,
        reversalNote,
        itemRow.name,
        actorName,
        beforeQuantity,
        afterQuantity,
        orig.unit || itemRow.unit,
        restoredBatchCost,
        currentUnitCost,
        newUnitCost,
        sessionId,
      ],
    );
    const reversalMovementId = Number(revMoveRes.insertId);

    const [linkRes] = await connection.execute(
      "UPDATE inventory_movements SET reversed_by_movement_id = ? WHERE id = ? AND reversed_by_movement_id IS NULL",
      [reversalMovementId, orig.id],
    );
    if (linkRes.affectedRows !== 1) {
      throw httpError(409, "This waste entry has already been reversed.");
    }

    let reversalJournalEntryId = null;
    const [[origJe]] = await connection.execute(
      "SELECT * FROM journal_entries WHERE inventory_movement_id = ? AND is_reversal = FALSE ORDER BY id ASC LIMIT 1 FOR UPDATE",
      [orig.id],
    );

    if (origJe) {
      const [[existingRevJe]] = await connection.execute(
        "SELECT id FROM journal_entries WHERE reverses_entry_id = ? LIMIT 1 FOR UPDATE",
        [origJe.id],
      );
      if (existingRevJe) {
        // GL entry was already reversed directly in Finances; link its id without deadlocking stock restoration
        reversalJournalEntryId = Number(existingRevJe.id);
      } else {
        const [origLines] = await connection.execute(
          "SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?",
          [origJe.id],
        );

        if (origLines && origLines.length > 0) {
          const reversalEntryNumber = generateEntryNumber("REV");
          const [revJeRes] = await connection.execute(
            `INSERT INTO journal_entries (
               entry_number, entry_type, memo, reference_number,
               inventory_movement_id, session_id, is_reversal, reverses_entry_id,
               idempotency_key, created_by
             ) VALUES (?, 'void_reversal', ?, ?, ?, ?, TRUE, ?, ?, ?)`,
            [
              reversalEntryNumber,
              `Reversal of waste movement #${orig.id} (${origJe.entry_number}): ${cleanReason}`.slice(0, 500),
              `REV-WASTE-${orig.id}`,
              reversalMovementId,
              sessionId,
              origJe.id,
              `inv_move:${reversalMovementId}:waste_reversal`,
              request.authUser.sub,
            ],
          );
          reversalJournalEntryId = Number(revJeRes.insertId);

          for (const line of origLines) {
            await connection.execute(
              `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo)
               VALUES (?, ?, ?, ?, ?)`,
              [
                reversalJournalEntryId,
                line.account_id,
                round2(line.credit),
                round2(line.debit),
                `Reversal of line #${line.id} (waste log #${orig.id})`,
              ],
            );
          }
        }
      }
    }

    await connection.commit();
    responsePayload = {
      originalMovementId: Number(orig.id),
      reversalMovementId,
      itemId: Number(itemRow.id),
      itemName: itemRow.name,
      restoredQuantity,
      beforeQuantity,
      afterQuantity,
      unit: orig.unit || itemRow.unit,
      journalEntryId: reversalJournalEntryId,
      reason: cleanReason,
      reversedBy: actorName,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  response.json(responsePayload);
});

router.post("/:id/waste", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw httpError(400, "Invalid inventory ID.");
  }

  const includeCost = request.authUser.role === "admin";
  const {
    measurementMethod,
    measuredQuantity,
    measuredUnit,
    tareWeight = null,
    wasteReason,
    note,
    clientRequestId,
  } = request.body || {};

  const hasClientRequestIdField =
    clientRequestId !== undefined && clientRequestId !== null && String(clientRequestId) !== "";
  const rawClientReqId =
    clientRequestId !== undefined && clientRequestId !== null ? String(clientRequestId).trim() : "";
  if (hasClientRequestIdField && !CLIENT_REQUEST_ID_REGEX.test(rawClientReqId)) {
    throw httpError(400, "Invalid clientRequestId format.");
  }
  const cleanClientRequestId = rawClientReqId || null;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Staff";

  const connection = await pool.getConnection();
  let txOpen = false;
  try {
    await connection.beginTransaction();
    txOpen = true;

    if (cleanClientRequestId) {
      const existingMove = await findExistingWasteByClientRequest(
        connection,
        request.authUser.sub,
        cleanClientRequestId,
      );
      if (existingMove) {
        assertWasteReplayMatches(existingMove, id, request.body || {});
        await connection.rollback();
        txOpen = false;
        return response.status(200).json(formatWasteResponseRow(existingMove, includeCost));
      }
    }

    const [[current]] = await connection.execute(
      "SELECT * FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE",
      [id],
    );
    if (!current) {
      throw httpError(404, "Inventory item not found.");
    }

    const calc = computeWasteDeduction({
      item: {
        id: Number(current.id),
        name: current.name,
        unit: current.unit,
        quantity: Number(current.quantity || 0),
        packageUnit: current.package_unit,
        contentsPerPackage: Number(current.contents_per_package || 1),
      },
      measurementMethod,
      measuredQuantity,
      measuredUnit,
      tareWeight,
      wasteReason,
      note,
      beforeQuantity: Number(current.quantity || 0),
    });

    if (!calc.ok) {
      throw httpError(400, calc.error);
    }

    let [[activeSession]] = await connection.execute(
      "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
      [request.authUser.sub],
    );
    if (!activeSession) {
      [[activeSession]] = await connection.execute(
        "SELECT id FROM cashier_sessions WHERE status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
      );
    }
    const sessionId = activeSession ? Number(activeSession.id) : null;

    await connection.execute(
      "UPDATE inventory_items SET quantity = ? WHERE id = ? AND is_archived = FALSE",
      [calc.afterQuantity, id],
    );

    const unitCost = Number(current.unit_cost || 0);
    const wasteValue = round2(calc.deductedQuantity * unitCost);
    let movementId = null;

    try {
      const [moveRes] = await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           batch_cost, unit_cost_before, unit_cost_after, session_id,
           waste_reason, measurement_method, measured_input_qty, measured_input_unit, tare_weight, client_request_id
         ) VALUES (?, ?, 'spoilage', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          request.authUser.sub,
          -calc.deductedQuantity,
          calc.note,
          current.name,
          actorName,
          calc.beforeQuantity,
          calc.afterQuantity,
          current.unit,
          wasteValue,
          unitCost,
          unitCost,
          sessionId,
          calc.wasteReason,
          calc.measurementMethod,
          calc.measuredInputQty,
          calc.measuredInputUnit,
          calc.tareWeight,
          cleanClientRequestId,
        ],
      );
      movementId = Number(moveRes.insertId);
    } catch (insertError) {
      if (cleanClientRequestId && insertError?.code === "ER_DUP_ENTRY") {
        await connection.rollback();
        txOpen = false;
        const raceExisting = await findExistingWasteByClientRequest(
          pool,
          request.authUser.sub,
          cleanClientRequestId,
        );
        if (raceExisting) {
          assertWasteReplayMatches(raceExisting, id, request.body || {});
          return response.status(200).json(formatWasteResponseRow(raceExisting, includeCost));
        }
      }
      throw insertError;
    }

    const ledgerRes = await postInventoryValuationDelta(connection, {
      inventoryMovementId: movementId,
      itemName: current.name,
      deltaValue: -wasteValue,
      entryType: "adjustment",
      offsetAccountCode: "6030",
      memo: `Waste / spoilage (${calc.wasteReason}): ${current.name} (-${calc.deductedQuantity} ${current.unit})`,
      referenceNumber: `WASTE-${movementId}`,
      sessionId,
      userId: request.authUser.sub,
    });

    const reasonLabel = WASTE_REASON_MAP[calc.wasteReason]?.label || calc.wasteReason;
    const notifTitle = `Waste Logged: ${current.name}`.slice(0, 180);
    const notifMessage = `${actorName} logged -${calc.deductedQuantity} ${current.unit} (${reasonLabel})${wasteValue > 0 ? ` · ₱${wasteValue.toFixed(2)} loss` : ""} · ${calc.note}`.slice(0, 1000);
    const notifEventKey = `inventory-waste-${movementId}`.slice(0, 120);
    await connection.execute(
      `INSERT INTO notifications (user_id, event_key, type, title, message)
       SELECT id, ?, 'inventory_waste', ?, ?
         FROM users
        WHERE is_active = TRUE AND role = 'admin'
       ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)`,
      [notifEventKey, notifTitle, notifMessage],
    );

    await connection.commit();
    txOpen = false;

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

    return response.status(201).json(
      formatWasteResponseRow(createdRow, includeCost, ledgerRes?.entryId ?? null),
    );
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
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
  const imageUrl = validateImageUrl(image ?? null);
  const quantity = Number(request.body.quantity || 0);
  const maximumStock = request.body.maximumStock == null || request.body.maximumStock === "" ? null : Number(request.body.maximumStock);
  const supplierName = String(request.body?.supplierName || "").trim().slice(0, 120) || null;
  const referenceNo = String(request.body?.referenceNo || "").trim().slice(0, 80) || null;
  const packedUnitError = unitWithAmountError(cleanUnit);
  if (packedUnitError) throw httpError(400, packedUnitError);
  if (!name || name.length > 160 || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock <= 0))) {
    throw httpError(400, "Enter a valid inventory name, category, unit, and quantity. Maximum stock must be above zero or omitted.");
  }
  const { purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost } = resolveCosting(request.body);
  // Blank maximum on create falls back to the starting quantity (only when there is stock).
  const effectiveMaximumStock = maximumStock === null && quantity > 0 ? quantity : maximumStock;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";

  const connection = await pool.getConnection();
  let createdId;
  try {
    await connection.beginTransaction();
    const [[activeSession]] = await connection.execute(
      "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
      [request.authUser.sub],
    );
    const sessionId = activeSession ? Number(activeSession.id) : null;
    const [created] = await connection.execute(
      `INSERT INTO inventory_items (
         name, image_url, category, quantity, unit, maximum_stock,
         purchase_price, package_quantity, package_unit, contents_per_package, unit_cost
       ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [name, imageUrl, cleanCategory, cleanUnit, effectiveMaximumStock, purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost],
    );
    createdId = created.insertId;
    await syncCupRow(connection, createdId, cleanCategory, name);
    if (quantity > 0) {
      await connection.execute("UPDATE inventory_items SET quantity = ? WHERE id = ?", [quantity, createdId]);
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
          purchasePrice > 0 ? Number(purchasePrice.toFixed(2)) : null,
          unitCost,
          supplierName,
          referenceNo,
          sessionId,
        ],
      );
      const openingValue = Number((quantity * unitCost).toFixed(2));
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
  } catch (error) {
    await connection.rollback();
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
    // A unit change no longer blocks: menu recipes/add-ons follow the inventory unit (same transaction).
    if (String(current.unit).trim().toLowerCase() !== cleanUnit.toLowerCase()) {
      const oldDim = getUnitDimension(current.unit);
      const newDim = getUnitDimension(cleanUnit);
      const changed = await retargetRecipeUnits(connection, id, current.unit, cleanUnit);
      if (changed > 0 && oldDim && newDim && oldDim !== newDim) {
        unitDimensionWarning = `Unit dimension changed (${oldDim} → ${newDim}) across ${changed} recipe row(s). Verify recipe portion amounts.`;
      }
    }

    const { purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost } = resolveCosting(request.body, current);
    const effectiveImage = imageUrl !== undefined ? imageUrl : current.image_url;

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
    const adjOffsetAccount = ["6030", "3010", "6010"].includes(String(request.body?.adjustmentAccountCode || "").trim())
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
  const id = Number(request.params.id);
  const quantity = Number(request.body?.quantity);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw httpError(400, "Restock quantity must be greater than zero.");

  const rawBatchCost = request.body?.batchCost;
  const hasBatchCost = rawBatchCost !== undefined && rawBatchCost !== null && String(rawBatchCost).trim() !== "";
  const parsedBatchCost = hasBatchCost ? Number(rawBatchCost) : 0;
  if (hasBatchCost && (!Number.isFinite(parsedBatchCost) || parsedBatchCost < 0)) {
    throw httpError(400, "Batch cost must be zero or greater.");
  }
  const diluteZeroCost = Boolean(request.body?.diluteZeroCost);
  const rawCreditAccount = String(request.body?.creditAccountCode || "1010").trim();
  if (!ALLOWED_RESTOCK_ACCOUNTS.has(rawCreditAccount)) {
    throw httpError(400, "Invalid restock funding account. Allowed: 1010, 1020, 1030, 1040, 2010, 3010.");
  }
  const supplierName = String(request.body?.supplierName || "").trim().slice(0, 120) || null;
  const referenceNo = String(request.body?.referenceNo || "").trim().slice(0, 80) || null;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";

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
    const beforeQuantity = Number(current.quantity || 0);
    const afterQuantity = Math.round((beforeQuantity + quantity) * 1000000) / 1000000;
    const oldCost = Number(current.unit_cost || 0);
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
           batch_cost, unit_cost_before, unit_cost_after, supplier_name, reference_no, session_id
         ) VALUES (?, ?, 'restock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ],
      );
      restockMoveId = moveRes.insertId;
    } else {
      await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ? AND is_archived = FALSE", [quantity, id]);
      const [moveRes] = await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           batch_cost, unit_cost_before, unit_cost_after, supplier_name, reference_no, session_id
         ) VALUES (?, ?, 'restock', ?, 'Inventory restock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ],
      );
      restockMoveId = moveRes.insertId;
    }
    // Automated double-entry posting for inventory restock
    if (hasBatchCost && parsedBatchCost > 0) {
      const cleanCost = Number(parsedBatchCost.toFixed(2));
      await postBalancedEntry(connection, {
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
    }

    // First restock of an item that has no maximum and no stock (e.g. auto-created from a menu
    // recipe at 0): use the restocked amount as the maximum. Never touches a maximum that is set.
    if (current.maximum_stock == null && Number(current.quantity || 0) <= 0) {
      await connection.execute("UPDATE inventory_items SET maximum_stock = ? WHERE id = ? AND maximum_stock IS NULL", [quantity, id]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  const payload = await fetchMappedItemById(id, true);
  response.json(payload);
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
