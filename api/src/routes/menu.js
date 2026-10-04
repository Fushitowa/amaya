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
    addons: addons.filter((entry) => Number(entry.product_id) === Number(row.id)).map((entry) => ({ label: entry.label, price: Number(entry.price) })),
    ingredients: ingredients.filter((entry) => Number(entry.product_id) === Number(row.id)).map((entry) => entry.name),
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
    pool.execute(`SELECT product_id, label, price FROM product_addons WHERE product_id IN (${marks}) ORDER BY display_order, id`, ids),
    pool.execute(`SELECT pi.product_id, i.name FROM product_ingredients pi JOIN inventory_items i ON i.id = pi.inventory_item_id WHERE pi.product_id IN (${marks}) ORDER BY pi.id`, ids),
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
  await connection.execute("DELETE FROM product_sizes WHERE product_id = ?", [productId]);
  await connection.execute("DELETE FROM product_addons WHERE product_id = ?", [productId]);
  await connection.execute("DELETE FROM product_ingredients WHERE product_id = ?", [productId]);

  for (const [index, size] of sizes.entries()) {
    const label = String(size?.label || "").trim();
    if (!label) continue;
    await connection.execute("INSERT INTO product_sizes (product_id, label, price, display_order) VALUES (?, ?, ?, ?)", [productId, label.slice(0, 80), toMoney(size.price, "Size price"), index]);
  }
  for (const [index, addon] of addons.entries()) {
    const label = String(addon?.label || "").trim();
    if (!label) continue;
    await connection.execute("INSERT INTO product_addons (product_id, label, price, display_order) VALUES (?, ?, ?, ?)", [productId, label.slice(0, 100), toMoney(addon.price ?? 0, "Add-on price"), index]);
  }
  const uniqueIngredients = new Map();
  ingredients.map((name) => String(name || "").trim()).filter(Boolean).forEach((name) => uniqueIngredients.set(name.toLowerCase(), name));
  for (const entry of uniqueIngredients.values()) {
    const [result] = await connection.execute(
      `INSERT INTO inventory_items (name, category, quantity, unit, minimum_stock, added_from_menu)
       VALUES (?, 'Supplies', 0, 'pcs', 10, TRUE)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [entry.slice(0, 160)],
    );
    await connection.execute("INSERT INTO product_ingredients (product_id, inventory_item_id) VALUES (?, ?)", [productId, result.insertId]);
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
