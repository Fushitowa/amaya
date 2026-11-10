import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { recordArchiveAudit } from "./archive.js";
import { retargetRecipeUnits } from "../utils/recipeUnitSync.js";

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
    ...(includeCost ? {
      purchasePrice,
      packageQuantity,
      packageUnit: row.package_unit || "pack",
      contentsPerPackage,
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
            COUNT(i.id) AS itemCount
       FROM inventory_categories c
       LEFT JOIN inventory_items i ON i.category COLLATE utf8mb4_unicode_ci = c.name COLLATE utf8mb4_unicode_ci AND i.is_archived = FALSE
      WHERE (? = 1 OR c.is_active = TRUE)
      GROUP BY c.id
      ORDER BY c.display_order ASC, c.name ASC`,
    [showAll ? 1 : 0],
  );

  response.json(rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    isCupCategory: Boolean(row.isCupCategory),
    isSystem: Boolean(row.isSystem),
    displayOrder: Number(row.displayOrder || 0),
    isActive: Boolean(row.isActive),
    itemCount: Number(row.itemCount || 0),
  })));
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
    note: includeCost ? (row.note || "") : (row.note ? String(row.note).replace(/ for ₱[0-9.,]+ · new avg ₱[0-9.,]+\/[^)]+/gi, "") : ""),
    actorId: row.user_id == null ? null : Number(row.user_id),
    actor: row.actor_name || "System",
    timestamp: new Date(row.created_at).toISOString(),
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
      await connection.execute(
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
      await retargetRecipeUnits(connection, id, current.unit, cleanUnit);
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
    if (delta !== 0 || costChanged) {
      const note = delta !== 0
        ? (costChanged ? "Manual stock & cost adjustment" : "Manual inventory adjustment")
        : "Manual unit cost adjustment";
      await connection.execute(
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
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "An inventory item with that name already exists.");
    throw error;
  } finally {
    connection.release();
  }
  response.json(await fetchMappedItemById(id, true));
});

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

    if (hasBatchCost && parsedBatchCost > 0) {
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
      await connection.execute(
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
    } else {
      await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ? AND is_archived = FALSE", [quantity, id]);
      await connection.execute(
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
  response.json(await fetchMappedItemById(id, true));
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
