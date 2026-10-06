import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const mapItem = (row) => ({
  id: Number(row.id), item: row.name, category: row.category,
  quantity: Number(row.quantity), unit: row.unit,
  minimumStock: Number(row.minimum_stock), addedFromMenu: Boolean(row.added_from_menu),
  lastUpdated: new Date(row.updated_at).toISOString(),
});

router.get("/", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  const [rows] = await pool.execute("SELECT * FROM inventory_items ORDER BY category, name");
  response.json(rows.map(mapItem));
});

router.post("/", requireAuth, requireRole("admin"), async (request, response) => {
  const { item, category, unit } = request.body || {};
  const name = String(item || "").trim();
  const cleanCategory = String(category || "Supplies").trim();
  const cleanUnit = String(unit || "pcs").trim();
  const quantity = Number(request.body.quantity || 0);
  const minimumStock = Number(request.body.minimumStock || 0);
  if (!name || name.length > 160 || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimumStock) || minimumStock < 0) {
    throw httpError(400, "Enter a valid inventory name, category, unit, and non-negative quantities.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [created] = await connection.execute(
      "INSERT INTO inventory_items (name, category, quantity, unit, minimum_stock) VALUES (?, ?, 0, ?, ?)",
      [name, cleanCategory, cleanUnit, minimumStock],
    );
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
  if (!Number.isSafeInteger(id) || id <= 0 || !name || !cleanCategory || !cleanUnit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimumStock) || minimumStock < 0) {
    throw httpError(400, "Enter valid inventory values.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[current]] = await connection.execute("SELECT quantity, unit FROM inventory_items WHERE id = ? FOR UPDATE", [id]);
    if (!current) throw httpError(404, "Inventory item not found.");
    if (String(current.unit).trim().toLowerCase() !== cleanUnit.toLowerCase()) {
      const [[recipeUsage]] = await connection.execute(
        "SELECT (SELECT COUNT(*) FROM product_ingredients WHERE inventory_item_id = ?) + (SELECT COUNT(*) FROM product_addons WHERE inventory_item_id = ?) AS total", [id, id],
      );
      if (Number(recipeUsage.total) > 0) throw httpError(409, "This unit is used by a menu ingredient or add-on. Remove it from those menu items before changing the inventory unit.");
    }
    await connection.execute("UPDATE inventory_items SET name = ?, category = ?, quantity = ?, unit = ?, minimum_stock = ? WHERE id = ?", [name, cleanCategory, quantity, cleanUnit, minimumStock, id]);
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
    const [result] = await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?", [quantity, id]);
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
  const [[usage]] = await pool.execute("SELECT (SELECT COUNT(*) FROM product_ingredients WHERE inventory_item_id = ?) AS recipes, (SELECT COUNT(*) FROM product_addons WHERE inventory_item_id = ?) AS addons, (SELECT COUNT(*) FROM inventory_movements WHERE inventory_item_id = ?) AS movements", [id, id, id]);
  if (Number(usage.recipes) > 0 || Number(usage.addons) > 0) throw httpError(409, "This inventory item is used by a menu ingredient or add-on. Remove it from those menu items before deleting it.");
  if (Number(usage.movements) > 0) throw httpError(409, "This item has stock history and cannot be deleted.");
  try {
    const [result] = await pool.execute("DELETE FROM inventory_items WHERE id = ?", [id]);
    if (!result.affectedRows) throw httpError(404, "Inventory item not found.");
    response.status(204).end();
  } catch (error) {
    if (error.code === "ER_ROW_IS_REFERENCED_2") throw httpError(409, "This item has related stock history and cannot be deleted.");
    throw error;
  }
});

export default router;
