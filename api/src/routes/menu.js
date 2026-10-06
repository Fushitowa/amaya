import { Router } from "express";
import pool from "../database.js";
import { httpError, optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const toMoney = (value, label) => {
  const clean = typeof value === "string" ? value.replace(/[^0-9.]/g, "") : value;
  const amount = clean === "" ? Number.NaN : Number(clean);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) throw httpError(400, `${label} must be a valid non-negative price.`);
  return amount.toFixed(2);
};
const idFrom = (value) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid menu item ID.");
  return id;
};

function toProduct(row, sizes, addons, ingredients) {
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category || "Uncategorized",
    price: `₱${Number(row.base_price).toFixed(2)}`,
    image: row.image_url || "",
    description: row.description || "",
    stock: Number(row.stock_quantity),
    available: Boolean(row.is_available),
    featured: Boolean(row.is_featured),
    sizes: sizes.filter((entry) => Number(entry.product_id) === Number(row.id)).map((entry) => ({ label: entry.label, price: Number(entry.price) })),
    addons: addons.filter((entry) => Number(entry.product_id) === Number(row.id)).map((entry) => ({
      label: entry.label,
      price: Number(entry.price),
      inventoryItemId: entry.inventory_item_id == null ? null : Number(entry.inventory_item_id),
      quantityUsed: entry.quantity_used == null ? null : Number(entry.quantity_used),
      unit: entry.inventory_unit || "pcs",
    })),
    ingredients: ingredients.filter((entry) => Number(entry.product_id) === Number(row.id)).map((entry) => ({
      inventoryItemId: Number(entry.inventory_item_id),
      name: entry.name,
      quantityUsed: entry.quantity_used == null ? null : Number(entry.quantity_used),
      unit: entry.unit || entry.inventory_unit,
    })),
  };
}

async function listProducts(includeUnavailable = false) {
  const [products] = await pool.execute(
    `SELECT p.*, c.name AS category
       FROM menu_products p LEFT JOIN menu_categories c ON c.id = p.category_id
      ${includeUnavailable ? "" : "WHERE p.is_available = TRUE"}
      ORDER BY p.display_order, p.name`,
  );
  if (!products.length) return [];
  const ids = products.map((product) => product.id);
  const marks = ids.map(() => "?").join(",");
  const [sizeResult, addonResult, ingredientResult] = await Promise.all([
    pool.execute(`SELECT product_id, label, price FROM product_sizes WHERE product_id IN (${marks}) ORDER BY display_order, id`, ids),
    pool.execute(`SELECT pa.product_id, pa.label, pa.price, pa.inventory_item_id, pa.quantity_used, i.unit AS inventory_unit FROM product_addons pa LEFT JOIN inventory_items i ON i.id = pa.inventory_item_id WHERE pa.product_id IN (${marks}) ORDER BY pa.display_order, pa.id`, ids),
    pool.execute(`SELECT pi.product_id, pi.inventory_item_id, pi.quantity_used, pi.unit, i.name, i.unit AS inventory_unit FROM product_ingredients pi JOIN inventory_items i ON i.id = pi.inventory_item_id WHERE pi.product_id IN (${marks}) ORDER BY pi.id`, ids),
  ]);
  const sizes = sizeResult[0];
  const addons = addonResult[0];
  const ingredients = ingredientResult[0];
  return products.map((product) => toProduct(product, sizes, addons, ingredients));
}

async function saveProduct(connection, body, id = null) {
  const name = String(body?.name || "").trim();
  const category = String(body?.category || "").trim();
  const description = String(body?.description || "").trim();
  if (!name || name.length > 160 || !category || category.length > 100) throw httpError(400, "Product name and category are required.");
  const basePrice = toMoney(body.basePrice ?? body.price, "Product price");
  const stock = Number(body.stock ?? 0);
  if (!Number.isSafeInteger(stock) || stock < 0) throw httpError(400, "Stock must be a non-negative whole number.");
  const image = body.image == null ? null : String(body.image);
  if (image && image.length > 8_000_000) throw httpError(413, "Product image is too large. Choose an image under 5 MB.");
  if (image && !(/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/|\/)/i.test(image))) {
    throw httpError(400, "Product image must be a PNG, JPG, or WEBP upload or a valid image URL.");
  }

  const [categoryRows] = await connection.execute(
    "INSERT INTO menu_categories (name) VALUES (?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
    [category],
  );
  const categoryId = categoryRows.insertId;
  let productId = id;
  const values = [categoryId, name, description || null, image, basePrice, stock, body.available !== false, Boolean(body.featured)];
  if (id == null) {
    const [result] = await connection.execute(
      `INSERT INTO menu_products (category_id, name, description, image_url, base_price, stock_quantity, is_available, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, values,
    );
    productId = result.insertId;
  } else {
    const [existing] = await connection.execute("SELECT id FROM menu_products WHERE id = ?", [id]);
    if (!existing.length) throw httpError(404, "Menu item not found.");
    await connection.execute(
      `UPDATE menu_products SET category_id = ?, name = ?, description = ?, image_url = ?, base_price = ?, stock_quantity = ?, is_available = ?, is_featured = ? WHERE id = ?`,
      [...values, id],
    );
  }

  const sizes = Array.isArray(body.sizes) && body.sizes.length ? body.sizes : [{ label: "Regular", price: basePrice }];
  const addons = Array.isArray(body.addons) ? body.addons : [];
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
  if (sizes.length > 20 || addons.length > 50 || ingredients.length > 100) throw httpError(400, "This menu item has too many sizes, add-ons, or ingredients.");

  const recipeInputs = ingredients.map((ingredient) => {
    const name = String(ingredient?.name || ingredient?.item || "").trim();
    const quantityUsed = Number(ingredient?.quantityUsed);
    const unit = String(ingredient?.unit || "pcs").trim();
    if (!name || name.length > 160 || !unit || unit.length > 40
      || !Number.isFinite(quantityUsed) || quantityUsed <= 0
      || Number(quantityUsed.toFixed(3)) !== quantityUsed) {
      throw httpError(400, "Each ingredient needs a name, stock unit, and positive amount with at most 3 decimal places.");
    }
    return { name, unit, quantityUsed };
  });
  if (new Set(recipeInputs.map((entry) => entry.name.toLocaleLowerCase())).size !== recipeInputs.length) {
    throw httpError(400, "Each ingredient name can only appear once in a recipe.");
  }
  const addonInputs = addons.map((addon) => {
    const label = String(addon?.label || "").trim();
    const unit = String(addon?.unit || "pcs").trim();
    const quantityUsed = Number(addon?.quantityUsed);
    if (!label || label.length > 100 || !unit || unit.length > 40
      || !Number.isFinite(quantityUsed) || quantityUsed <= 0
      || Number(quantityUsed.toFixed(3)) !== quantityUsed) {
      throw httpError(400, "Each add-on needs a name, price, stock unit, and positive usage amount with at most 3 decimal places.");
    }
    return { label, unit, quantityUsed, price: toMoney(addon.price ?? 0, "Add-on price") };
  });
  if (new Set(addonInputs.map((entry) => entry.label.toLocaleLowerCase())).size !== addonInputs.length) {
    throw httpError(400, "Each add-on name can only appear once per menu item.");
  }

  const ensureInventoryItem = async (itemName, unit, itemCategory) => {
    let result;
    try {
      [result] = await connection.execute(
        `INSERT INTO inventory_items (name, category, quantity, unit, minimum_stock, added_from_menu)
         VALUES (?, ?, 0, ?, 0, TRUE)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [itemName, itemCategory, unit],
      );
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") throw httpError(409, `Inventory already has “${itemName}” with a different spelling or name conflict. Check its existing entry.`);
      throw error;
    }
    const inventoryItemId = Number(result.insertId);
    const [[inventoryItem]] = await connection.execute(
      "SELECT id, name, unit FROM inventory_items WHERE id = ? FOR UPDATE", [inventoryItemId],
    );
    if (!inventoryItem) throw httpError(409, `Could not find the Inventory item for “${itemName}”.`);
    if (String(inventoryItem.unit).trim().toLocaleLowerCase() !== unit.toLocaleLowerCase()) {
      throw httpError(409, `Inventory already has “${inventoryItem.name}” measured in ${inventoryItem.unit}. Use that same unit for this menu item.`);
    }
    return inventoryItem;
  };

  const recipeItems = [];
  for (const entry of recipeInputs) {
    const item = await ensureInventoryItem(entry.name, entry.unit, "Supplies");
    recipeItems.push({ ...entry, inventoryItemId: Number(item.id), unit: item.unit });
  }
  const addonInventoryItems = [];
  for (const entry of addonInputs) {
    const item = await ensureInventoryItem(entry.label, entry.unit, "Toppings");
    addonInventoryItems.push({ ...entry, inventoryItemId: Number(item.id), unit: item.unit });
  }

  await connection.execute("DELETE FROM product_sizes WHERE product_id = ?", [productId]);
  await connection.execute("DELETE FROM product_addons WHERE product_id = ?", [productId]);
  await connection.execute("DELETE FROM product_ingredients WHERE product_id = ?", [productId]);

  for (const [index, size] of sizes.entries()) {
    const label = String(size?.label || "").trim();
    if (!label) continue;
    await connection.execute("INSERT INTO product_sizes (product_id, label, price, display_order) VALUES (?, ?, ?, ?)", [productId, label.slice(0, 80), toMoney(size.price, "Size price"), index]);
  }
  for (const [index, addon] of addonInventoryItems.entries()) {
    await connection.execute(
      "INSERT INTO product_addons (product_id, label, price, inventory_item_id, quantity_used, display_order) VALUES (?, ?, ?, ?, ?, ?)",
      [productId, addon.label, addon.price, addon.inventoryItemId, addon.quantityUsed, index],
    );
  }
  for (const entry of recipeItems) {
    await connection.execute(
      "INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit) VALUES (?, ?, ?, ?)",
      [productId, entry.inventoryItemId, entry.quantityUsed, entry.unit],
    );
  }
  return productId;
}

router.get("/", optionalAuth, async (request, response) => {
  const includeUnavailable = Boolean(request.authUser && ["admin", "staff"].includes(request.authUser.role))
    && request.query.all === "true";
  response.json(await listProducts(includeUnavailable));
});

router.post("/", requireAuth, requireRole("admin"), async (request, response) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const id = await saveProduct(connection, request.body);
    await connection.commit();
    response.status(201).json((await listProducts(true)).find((product) => product.id === Number(id)));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.put("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = idFrom(request.params.id);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await saveProduct(connection, request.body, id);
    await connection.commit();
    response.json((await listProducts(true)).find((product) => product.id === id));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.delete("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = idFrom(request.params.id);
  const [result] = await pool.execute("DELETE FROM menu_products WHERE id = ?", [id]);
  if (!result.affectedRows) throw httpError(404, "Menu item not found.");
  response.status(204).end();
});

export default router;
