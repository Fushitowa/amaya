import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const mapItem = (row) => ({
  id: Number(row.id), item: row.name, category: row.category,
  quantity: Number(row.quantity), unit: row.unit,
  maximumStock: row.maximum_stock == null ? null : Number(row.maximum_stock), addedFromMenu: Boolean(row.added_from_menu),
  lastUpdated: new Date(row.updated_at).toISOString(),
});
const unitWithAmountError = (unit) => {
  const match = String(unit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
  return match
    ? `Keep amount and unit separate. Enter ${match[1]} in the stock quantity field and “${match[2]}” as the unit (for example, quantity 5 and unit kg).`
    : null;
};

router.get("/", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  const [rows] = await pool.execute("SELECT * FROM inventory_items WHERE archived_at IS NULL ORDER BY category, name");
  response.json(rows.map(mapItem));
});

router.get("/:id/movements", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid inventory ID.");
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit, 10) || 30));
  const [[item]] = await pool.execute("SELECT id FROM inventory_items WHERE id = ? AND archived_at IS NULL", [id]);
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
  const maximumStock = request.body.maximumStock == null || request.body.maximumStock === "" ? null : Number(request.body.maximumStock);
  const packedUnitError = unitWithAmountError(cleanUnit);
  if (packedUnitError) throw httpError(400, packedUnitError);
  if (!name || name.length > 160 || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock <= 0))) {
    throw httpError(400, "Enter a valid inventory name, category, unit, and quantity. Maximum stock must be above zero or omitted.");
  }
  const connection = await pool.getConnection();
  let createdId;
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute(
      "INSERT INTO inventory_items (name, category, quantity, unit, maximum_stock) VALUES (?, ?, 0, ?, ?)",
      [name, cleanCategory, cleanUnit, maximumStock],
    );
    createdId = created.insertId;
    if (quantity > 0) {
      await connection.execute("UPDATE inventory_items SET quantity = ? WHERE id = ?", [quantity, created.insertId]);
      await connection.execute("INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'restock', ?, 'Opening stock')", [created.insertId, request.authUser.sub, quantity]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "An inventory item with that name already exists.");
    throw error;
  } finally { connection.release(); }
  const [[row]] = await pool.execute("SELECT * FROM inventory_items WHERE id = ? AND archived_at IS NULL", [createdId]);
  response.status(201).json(mapItem(row));
});

router.put("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  const { item, category, unit } = request.body || {};
  const name = String(item || "").trim();
  const cleanCategory = String(category || "").trim();
  const cleanUnit = String(unit || "").trim();
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
    const [[current]] = await connection.execute("SELECT quantity, unit FROM inventory_items WHERE id = ? AND archived_at IS NULL FOR UPDATE", [id]);
    if (!current) throw httpError(404, "Inventory item not found.");
    if (String(current.unit).trim().toLowerCase() !== cleanUnit.toLowerCase()) {
      const [[recipeUsage]] = await connection.execute(
        "SELECT (SELECT COUNT(*) FROM product_ingredients WHERE inventory_item_id = ?) + (SELECT COUNT(*) FROM product_addons WHERE inventory_item_id = ?) AS total", [id, id],
      );
      if (Number(recipeUsage.total) > 0) throw httpError(409, "This unit is used by a menu ingredient or add-on. Remove it from those menu items before changing the inventory unit.");
    }
    await connection.execute("UPDATE inventory_items SET name = ?, category = ?, quantity = ?, unit = ?, maximum_stock = ? WHERE id = ?", [name, cleanCategory, quantity, cleanUnit, maximumStock, id]);
    const delta = quantity - Number(current.quantity);
    if (delta !== 0) await connection.execute("INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'adjustment', ?, 'Manual inventory adjustment')", [id, request.authUser.sub, delta]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw httpError(409, "An inventory item with that name already exists.");
    throw error;
  } finally { connection.release(); }
  const [[row]] = await pool.execute("SELECT * FROM inventory_items WHERE id = ? AND archived_at IS NULL", [id]);
  response.json(mapItem(row));
});

router.post("/:id/restock", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  const quantity = Number(request.body.quantity);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw httpError(400, "Restock quantity must be greater than zero.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ? AND archived_at IS NULL", [quantity, id]);
    if (!result.affectedRows) throw httpError(404, "Inventory item not found.");
    await connection.execute("INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note) VALUES (?, ?, 'restock', ?, 'Inventory restock')", [id, request.authUser.sub, quantity]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
  const [[row]] = await pool.execute("SELECT * FROM inventory_items WHERE id = ? AND archived_at IS NULL", [id]);
  response.json(mapItem(row));
});

router.delete("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid inventory ID.");
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[item]] = await connection.execute("SELECT id FROM inventory_items WHERE id = ? AND archived_at IS NULL FOR UPDATE", [id]);
    if (!item) throw httpError(404, "Inventory item not found.");
    const [[usage]] = await connection.execute(
      "SELECT (SELECT COUNT(*) FROM product_ingredients WHERE inventory_item_id = ?) AS recipes, (SELECT COUNT(*) FROM product_addons WHERE inventory_item_id = ?) AS addons",
      [id, id],
    );
    if (Number(usage.recipes) > 0 || Number(usage.addons) > 0) {
      throw httpError(409, "This item is still used by a menu recipe or add-on. Remove it from those menu items before deleting it.");
    }
    await connection.execute("UPDATE inventory_items SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    await connection.commit();
    response.status(204).end();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
});

export default router;
