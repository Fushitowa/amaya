import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { recordArchiveAudit } from "./archive.js";

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
    category: row.category,
    quantity,
    unit: row.unit,
    minimumStock: Number(row.minimum_stock || 0),
    addedFromMenu: Boolean(row.added_from_menu),
    purchasePrice,
    packageQuantity,
    packageUnit: row.package_unit || "pack",
    contentsPerPackage,
    unitCost,
    inventoryValue: Number((quantity * unitCost).toFixed(2)),
    lastUpdated: new Date(row.updated_at).toISOString(),
  };
};

const unitWithAmountError = (unit) => {
  const match = String(unit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
  return match
    ? `Keep amount and unit separate. Enter ${match[1]} in the stock quantity field and “${match[2]}” as the unit (for example, quantity 5 and unit kg).`
    : null;
};

router.get("/summary", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  const [rows] = await pool.execute(
    `SELECT
       COUNT(*) AS total_items,
       COALESCE(SUM(quantity * unit_cost), 0) AS total_value,
       COALESCE(SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count,
       COALESCE(SUM(CASE WHEN quantity > 0 AND quantity <= minimum_stock THEN 1 ELSE 0 END), 0) AS low_stock_count,
       COALESCE(SUM(CASE WHEN quantity > minimum_stock THEN 1 ELSE 0 END), 0) AS in_stock_count
     FROM inventory_items WHERE is_archived = FALSE`,
  );
  const row = rows[0] || {};
  response.json({
    totalItems: Number(row.total_items || 0),
    totalValue: Number(Number(row.total_value || 0).toFixed(2)),
    outOfStockCount: Number(row.out_of_stock_count || 0),
    lowStockCount: Number(row.low_stock_count || 0),
    inStockCount: Number(row.in_stock_count || 0),
  });
});

router.get("/", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  const [rows] = await pool.execute("SELECT * FROM inventory_items WHERE is_archived = FALSE ORDER BY category, name");
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
  const { item, category, unit } = request.body || {};
  const name = String(item || "").trim();
  const cleanCategory = String(category || "Supplies").trim();
  const cleanUnit = String(unit || "pcs").trim();
  const quantity = Number(request.body.quantity || 0);
  const minimumStock = Number(request.body.minimumStock || 0);
  const packedUnitError = unitWithAmountError(cleanUnit);
  if (packedUnitError) throw httpError(400, packedUnitError);
  if (!name || name.length > 160 || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimumStock) || minimumStock < 0) {
    throw httpError(400, "Enter a valid inventory name, category, unit, and non-negative quantities.");
  }
  const purchasePrice = Math.max(0, Number(request.body.purchasePrice || 0));
  const packageQuantity = Math.max(0.001, Number(request.body.packageQuantity || 1));
  const packageUnit = String(request.body.packageUnit || "pack").trim().slice(0, 40) || "pack";
  const contentsPerPackage = Math.max(0.001, Number(request.body.contentsPerPackage || 1));
  let calculatedUnitCost = 0;
  if (purchasePrice > 0 && packageQuantity > 0 && contentsPerPackage > 0) {
    calculatedUnitCost = purchasePrice / (packageQuantity * contentsPerPackage);
  } else if (Number(request.body.unitCost) > 0) {
    calculatedUnitCost = Number(request.body.unitCost);
  }
  const unitCost = Number(calculatedUnitCost.toFixed(4));

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute(
      `INSERT INTO inventory_items (
         name, category, quantity, unit, minimum_stock,
         purchase_price, package_quantity, package_unit, contents_per_package, unit_cost
       ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [name, cleanCategory, cleanUnit, minimumStock, purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost],
    );
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
  const { item, category, unit } = request.body || {};
  const name = String(item || "").trim();
  const cleanCategory = String(category || "").trim();
  const cleanUnit = String(unit || "").trim();
  const quantity = Number(request.body.quantity);
  const minimumStock = Number(request.body.minimumStock);
  const packedUnitError = unitWithAmountError(cleanUnit);
  if (packedUnitError) throw httpError(400, packedUnitError);
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimumStock) || minimumStock < 0) {
    throw httpError(400, "Enter valid inventory values.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[current]] = await connection.execute("SELECT * FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE", [id]);
    if (!current) throw httpError(404, "Inventory item not found.");
    if (String(current.unit).trim().toLowerCase() !== cleanUnit.toLowerCase()) {
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
        throw httpError(409, `This unit is used in recipes/add-ons for: ${productNames}. Remove it from those menu items before changing the inventory unit.`);
      }
    }

    const purchasePrice = Math.max(0, Number(request.body.purchasePrice !== undefined ? request.body.purchasePrice : current.purchase_price || 0));
    const packageQuantity = Math.max(0.001, Number(request.body.packageQuantity || current.package_quantity || 1));
    const packageUnit = String(request.body.packageUnit || current.package_unit || "pack").trim().slice(0, 40) || "pack";
    const contentsPerPackage = Math.max(0.001, Number(request.body.contentsPerPackage || current.contents_per_package || 1));
    let calculatedUnitCost = 0;
    if (purchasePrice > 0 && packageQuantity > 0 && contentsPerPackage > 0) {
      calculatedUnitCost = purchasePrice / (packageQuantity * contentsPerPackage);
    } else if (Number(request.body.unitCost) > 0) {
      calculatedUnitCost = Number(request.body.unitCost);
    } else {
      calculatedUnitCost = Number(current.unit_cost || 0);
    }
    const unitCost = Number(calculatedUnitCost.toFixed(4));

    await connection.execute(
      `UPDATE inventory_items SET
         name = ?, category = ?, quantity = ?, unit = ?, minimum_stock = ?,
         purchase_price = ?, package_quantity = ?, package_unit = ?, contents_per_package = ?, unit_cost = ?
       WHERE id = ?`,
      [name, cleanCategory, quantity, cleanUnit, minimumStock, purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost, id],
    );
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
  const quantity = Number(request.body.quantity);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw httpError(400, "Restock quantity must be greater than zero.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ? AND is_archived = FALSE", [quantity, id]);
    if (!result.affectedRows) throw httpError(404, "Inventory item not found.");
    await connection.execute("INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'restock', ?, 'Inventory restock')", [id, request.authUser.sub, quantity]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  const [[row]] = await pool.execute("SELECT * FROM inventory_items WHERE id = ?", [id]);
  response.json(mapItem(row));
});

router.delete("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid inventory ID.");
  const [[existing]] = await pool.execute(
    "SELECT id, name, category, quantity, unit FROM inventory_items WHERE id = ? AND is_archived = FALSE",
    [id],
  );
  if (!existing) throw httpError(404, "Inventory item not found.");

  const [linkedRows] = await pool.execute(
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
    throw httpError(409, `This inventory item is used in recipes/add-ons for active menu item(s): ${productNames}. Archive or remove it from those menu items in Menu Management first.`);
  }

  await pool.execute(
    "UPDATE inventory_items SET is_archived = TRUE, archived_at = NOW(), archived_by = ? WHERE id = ?",
    [request.authUser?.sub || null, id],
  );
  await recordArchiveAudit(pool, {
    entityType: "inventory_item",
    entityId: id,
    entityName: existing.name,
    action: "archived",
    actorId: request.authUser?.sub || null,
    actorName: request.authUser?.username || "Admin",
    note: "Moved to 30-day Archive from Inventory Management",
    metadata: { category: existing.category, quantity: Number(existing.quantity), unit: existing.unit },
  });
  response.status(204).end();
});

export default router;
