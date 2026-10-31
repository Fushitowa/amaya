import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { recordArchiveAudit } from "./archive.js";
import { retargetRecipeUnits } from "../utils/recipeUnitSync.js";

const router = Router();
const mapItem = (row) => {
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
    purchasePrice,
    packageQuantity,
    packageUnit: row.package_unit || "pack",
    contentsPerPackage,
    unitCost,
    inventoryValue: Number((quantity * unitCost).toFixed(2)),
    lastUpdated: new Date(row.updated_at).toISOString(),
    isCupCategory: Boolean(row.is_cup_category) || row.category === "Cups" || row.category === "Cups & Lids",
  };
};

const unitWithAmountError = (unit) => {
  const match = String(unit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
  return match
    ? `Keep amount and unit separate. Enter ${match[1]} in the stock quantity field and “${match[2]}” as the unit (for example, quantity 5 and unit kg).`
    : null;
};

const resolveCosting = (body = {}, current = {}) => {
  const rawPurchasePrice = body.purchasePrice !== undefined ? body.purchasePrice : (current.purchase_price ?? 0);
  const purchasePrice = rawPurchasePrice === "" || rawPurchasePrice == null ? 0 : Number(rawPurchasePrice);
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    throw httpError(400, "Purchase price must be zero or greater.");
  }

  const rawPkgQty = body.packageQuantity !== undefined ? body.packageQuantity : current.package_quantity;
  const rawContents = body.contentsPerPackage !== undefined ? body.contentsPerPackage : current.contents_per_package;
  const parsedPkgQty = rawPkgQty === "" || rawPkgQty == null ? 0 : Number(rawPkgQty);
  const parsedContents = rawContents === "" || rawContents == null ? 0 : Number(rawContents);

  if (purchasePrice > 0 && (!Number.isFinite(parsedPkgQty) || parsedPkgQty <= 0 || !Number.isFinite(parsedContents) || parsedContents <= 0)) {
    throw httpError(400, "Enter how much is inside one package so unit cost can be calculated.");
  }

  const packageQuantity = Number.isFinite(parsedPkgQty) && parsedPkgQty > 0 ? parsedPkgQty : 1;
  const contentsPerPackage = Number.isFinite(parsedContents) && parsedContents > 0 ? parsedContents : 1;
  const packageUnit = String(body.packageUnit || current.package_unit || "pack").trim().slice(0, 40) || "pack";
  const unitCost = purchasePrice > 0
    ? Number((purchasePrice / (packageQuantity * contentsPerPackage)).toFixed(6))
    : Number(current.unit_cost || 0);

  return { purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost };
};

// Keep inventory_cups in step with cup categories: cups get a row, anything else loses it.
const syncCupRow = async (connection, itemId, category, name) => {
  let isCupCategory = false;
  try {
    const [[catRow]] = await connection.execute(
      "SELECT is_cup_category FROM inventory_categories WHERE name = ? LIMIT 1",
      [category],
    );
    if (catRow) {
      isCupCategory = Boolean(catRow.is_cup_category);
    } else {
      isCupCategory = category === "Cups" || category === "Cups & Lids";
    }
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
       LEFT JOIN inventory_items i ON i.category = c.name AND i.is_archived = FALSE
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

router.get("/summary", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
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

router.get("/", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  const [rows] = await pool.execute(`
    SELECT ii.*, COALESCE(ic.is_cup_category, FALSE) AS is_cup_category
      FROM inventory_items ii
      LEFT JOIN inventory_categories ic ON LOWER(ii.category) = LOWER(ic.name)
     WHERE ii.is_archived = FALSE
     ORDER BY ii.category, ii.name
  `);
  response.json(rows.map(mapItem));
});

router.get("/:id/movements", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid inventory ID.");
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit, 10) || 30));
  const [[item]] = await pool.execute("SELECT id FROM inventory_items WHERE id = ?", [id]);
  if (!item) throw httpError(404, "Inventory item not found.");
  const [rows] = await pool.execute(
    `SELECT m.id, m.movement_type, m.quantity_change, m.note, m.created_at,
            u.username AS actor_name
       FROM inventory_movements m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.inventory_item_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`, [id, limit],
  );
  response.json(rows.map((row) => ({
    id: Number(row.id),
    type: row.movement_type,
    quantityChange: Number(row.quantity_change),
    note: row.note || "",
    actor: row.actor_name || "System",
    timestamp: new Date(row.created_at).toISOString(),
  })));
});

router.post("/", requireAuth, requireRole("admin"), async (request, response) => {
  const { item, category, unit, image } = request.body || {};
  const name = String(item || "").trim();
  const cleanCategory = String(category || "Supplies").trim();
  const cleanUnit = String(unit || "pcs").trim();
  const imageUrl = image != null ? String(image) : null;
  const quantity = Number(request.body.quantity || 0);
  const maximumStock = request.body.maximumStock == null || request.body.maximumStock === "" ? null : Number(request.body.maximumStock);
  const packedUnitError = unitWithAmountError(cleanUnit);
  if (packedUnitError) throw httpError(400, packedUnitError);
  if (!name || name.length > 160 || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock <= 0))) {
    throw httpError(400, "Enter a valid inventory name, category, unit, and quantity. Maximum stock must be above zero or omitted.");
  }
  const { purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost } = resolveCosting(request.body);
  // Blank maximum on create falls back to the starting quantity (only when there is stock).
  const effectiveMaximumStock = maximumStock === null && quantity > 0 ? quantity : maximumStock;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute(
      `INSERT INTO inventory_items (
         name, image_url, category, quantity, unit, maximum_stock,
         purchase_price, package_quantity, package_unit, contents_per_package, unit_cost
       ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [name, imageUrl, cleanCategory, cleanUnit, effectiveMaximumStock, purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost],
    );
    await syncCupRow(connection, created.insertId, cleanCategory, name);
    if (quantity > 0) {
      await connection.execute("UPDATE inventory_items SET quantity = ? WHERE id = ?", [quantity, created.insertId]);
      await connection.execute("INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'restock', ?, 'Opening stock')", [created.insertId, request.authUser.sub, quantity]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "An inventory item with that name already exists (check active inventory or the 30-day Archive).");
    throw error;
  } finally { connection.release(); }
  const [[row]] = await pool.execute("SELECT * FROM inventory_items WHERE name = ?", [name]);
  response.status(201).json(mapItem(row));
});

router.put("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  const { item, category, unit, image } = request.body || {};
  const name = String(item || "").trim();
  const cleanCategory = String(category || "").trim();
  const cleanUnit = String(unit || "").trim();
  const imageUrl = image !== undefined ? (image ? String(image) : null) : undefined;
  const quantity = Number(request.body.quantity);
  const maximumStock = request.body.maximumStock == null || request.body.maximumStock === "" ? null : Number(request.body.maximumStock);
  const packedUnitError = unitWithAmountError(cleanUnit);
  if (packedUnitError) throw httpError(400, packedUnitError);
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock <= 0))) {
    throw httpError(400, "Enter valid inventory values. Maximum stock must be above zero or omitted.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[current]] = await connection.execute("SELECT * FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE", [id]);
    if (!current) throw httpError(404, "Inventory item not found.");
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
    const delta = quantity - Number(current.quantity);
    if (delta !== 0) await connection.execute("INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'adjustment', ?, 'Manual inventory adjustment')", [id, request.authUser.sub, delta]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "An inventory item with that name already exists.");
    throw error;
  } finally { connection.release(); }
  const [[row]] = await pool.execute("SELECT * FROM inventory_items WHERE id = ?", [id]);
  response.json(mapItem(row));
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

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[current]] = await connection.execute("SELECT * FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE", [id]);
    if (!current) throw httpError(404, "Inventory item not found.");

    if (hasBatchCost && parsedBatchCost > 0) {
      const oldQty = Math.max(0, Number(current.quantity || 0));
      const oldCost = Math.max(0, Number(current.unit_cost || 0));
      const batchUnitCost = parsedBatchCost / quantity;
      const newUnitCost = oldQty > 0
        ? ((oldQty * oldCost) + parsedBatchCost) / (oldQty + quantity)
        : batchUnitCost;
      await connection.execute(
        "UPDATE inventory_items SET quantity = quantity + ?, unit_cost = ? WHERE id = ? AND is_archived = FALSE",
        [quantity, Number(newUnitCost.toFixed(6)), id],
      );
      const formattedAvg = Number(newUnitCost.toFixed(3)).toFixed(newUnitCost.toFixed(3).endsWith("0") ? 2 : 3);
      const note = `Inventory restock (+${quantity} ${current.unit} for ₱${parsedBatchCost.toFixed(2)} · new avg ₱${formattedAvg}/${current.unit})`;
      await connection.execute(
        "INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'restock', ?, ?)",
        [id, request.authUser.sub, quantity, note],
      );
    } else {
      await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ? AND is_archived = FALSE", [quantity, id]);
      await connection.execute("INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'restock', ?, 'Inventory restock')", [id, request.authUser.sub, quantity]);
    }
    // First restock of an item that has no maximum and no stock (e.g. auto-created from a menu
    // recipe at 0): use the restocked amount as the maximum. Never touches a maximum that is set.
    if (current.maximum_stock == null && Number(current.quantity || 0) <= 0) {
      await connection.execute("UPDATE inventory_items SET maximum_stock = ? WHERE id = ? AND maximum_stock IS NULL", [quantity, id]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  const [[row]] = await pool.execute("SELECT * FROM inventory_items WHERE id = ?", [id]);
  response.json(mapItem(row));
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
      actorName: request.authUser?.username || "Admin",
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
