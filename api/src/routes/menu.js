import { Router } from "express";
import pool from "../database.js";
import { httpError, optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { toInventoryQuantity } from "../utils/inventoryUnits.js";
import { recordArchiveAudit } from "./archive.js";

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
const explainPackedUnit = (name, value, fieldName) => {
	const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
	if (!match) return null;
	if (fieldName === "stock") {
		return `For “${name}”, the Inventory stock unit is “${value}”. Edit the inventory item and enter ${match[1]} as its stock quantity and “${match[2]}” as its unit.`;
	}
	return `For “${name}”, put ${match[1]} in Amount per serving and “${match[2]}” in Recipe unit. Keep the amount and unit in separate fields.`;
};

function toProduct(row, sizes, addons, ingredients, sizeIngredients, includeInventory) {
  const productIngredients = ingredients
    .filter((entry) => Number(entry.product_id) === Number(row.id))
    .map((entry) => ({
      inventoryItemId: Number(entry.inventory_item_id),
      name: entry.name,
      quantityUsed: entry.quantity_used == null ? null : Number(entry.quantity_used),
      unit: entry.unit || entry.inventory_unit,
      stockUnit: entry.inventory_unit,
      quantityInStockUnit: entry.quantity_used == null ? null : toInventoryQuantity(entry.quantity_used, entry.unit || entry.inventory_unit, entry.inventory_unit),
      ...(includeInventory ? {
        inventoryQuantity: Number(entry.inventory_quantity),
        maximumStock: entry.maximum_stock == null ? null : Number(entry.maximum_stock),
      } : {}),
    }));
  const productSizes = sizes
    .filter((entry) => Number(entry.product_id) === Number(row.id))
    .map((size) => {
      const overrides = sizeIngredients.filter((entry) => Number(entry.product_size_id) === Number(size.id));
      const recipes = productIngredients.map((base) => {
        const override = overrides.find((entry) => Number(entry.inventory_item_id) === base.inventoryItemId);
        return override ? {
          ...base,
          quantityUsed: Number(override.quantity_used),
          unit: override.unit,
          quantityInStockUnit: toInventoryQuantity(override.quantity_used, override.unit, base.stockUnit),
        } : base;
      });
      return {
        label: size.label,
        price: Number(size.price),
        ingredients: recipes,
      };
    });
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
    sizes: productSizes,
    addons: addons.filter((entry) => Number(entry.product_id) === Number(row.id)).map((entry) => ({
      label: entry.label,
      price: Number(entry.price),
      inventoryItemId: entry.inventory_item_id == null ? null : Number(entry.inventory_item_id),
      quantityUsed: entry.quantity_used == null ? null : Number(entry.quantity_used),
      unit: entry.usage_unit || entry.inventory_unit || "pcs",
      stockUnit: entry.inventory_unit || "pcs",
      quantityInStockUnit: entry.quantity_used == null ? null : toInventoryQuantity(entry.quantity_used, entry.usage_unit || entry.inventory_unit, entry.inventory_unit),
      ...(includeInventory ? {
        inventoryQuantity: Number(entry.inventory_quantity || 0),
        maximumStock: entry.maximum_stock == null ? null : Number(entry.maximum_stock),
      } : {}),
    })),
    ingredients: productIngredients,
  };
}

async function listProducts(includeUnavailable = false, includeInventory = false) {
  const [products] = await pool.execute(
    `SELECT p.*, c.name AS category
       FROM menu_products p LEFT JOIN menu_categories c ON c.id = p.category_id
      WHERE p.is_archived = FALSE ${includeUnavailable ? "" : "AND p.is_available = TRUE"}
      ORDER BY p.display_order, p.name`,
  );
  if (!products.length) return [];
  const ids = products.map((product) => product.id);
  const marks = ids.map(() => "?").join(",");
  const [addonResult, ingredientResult, sizeResult] = await Promise.all([
    pool.execute(`SELECT pa.product_id, pa.label, pa.price, pa.inventory_item_id, pa.quantity_used, pa.usage_unit, i.unit AS inventory_unit, i.quantity AS inventory_quantity, i.maximum_stock FROM product_addons pa LEFT JOIN inventory_items i ON i.id = pa.inventory_item_id WHERE pa.product_id IN (${marks}) ORDER BY pa.display_order, pa.id`, ids),
    pool.execute(`SELECT pi.product_id, pi.inventory_item_id, pi.quantity_used, pi.unit, i.name, i.unit AS inventory_unit, i.quantity AS inventory_quantity, i.maximum_stock FROM product_ingredients pi JOIN inventory_items i ON i.id = pi.inventory_item_id WHERE pi.product_id IN (${marks}) ORDER BY pi.id`, ids),
    pool.execute(`SELECT ps.product_id, ps.id, ps.label, ps.price FROM product_sizes ps WHERE ps.product_id IN (${marks}) ORDER BY ps.display_order, ps.id`, ids),
  ]);
  const addonRows = addonResult[0];
  const ingredientRows = ingredientResult[0];
  const sizeRows = sizeResult[0];
  const sizeIds = sizeRows.map((size) => size.id);
  let sizeIngredients = [];
  if (sizeIds.length) {
    const sizeMarks = sizeIds.map(() => "?").join(",");
    const [rows] = await pool.execute(
      `SELECT psi.product_size_id, psi.inventory_item_id, psi.quantity_used, psi.unit
         FROM product_size_ingredients psi WHERE psi.product_size_id IN (${sizeMarks})`, sizeIds,
    );
    sizeIngredients = rows;
  }
  const sizes = sizeRows;
  const addons = addonRows;
  const ingredients = ingredientRows;
  return products.map((product) => toProduct(product, sizes, addons, ingredients, sizeIngredients, includeInventory));
}

function normalizeRecipeEntries(entries, description) {
  return (Array.isArray(entries) ? entries : []).map((ingredient) => {
    const name = String(ingredient?.name || ingredient?.item || "").trim();
    const rawQuantity = String(ingredient?.quantityUsed ?? "").trim();
    const attachedAmount = rawQuantity.match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
    if (attachedAmount) throw httpError(400, `For “${name || "this ingredient"}”, enter only ${attachedAmount[1]} in Amount per serving and “${attachedAmount[2]}” in Recipe unit.`);
    const quantityUsed = Number(ingredient?.quantityUsed);
    const unit = String(ingredient?.unit || "pcs").trim();
    const stockUnit = String(ingredient?.stockUnit || unit).trim();
    const packedUnitError = explainPackedUnit(name || "this ingredient", unit, "recipe")
      || explainPackedUnit(name || "this ingredient", stockUnit, "stock");
    if (packedUnitError) throw httpError(400, packedUnitError);
    if (!name || name.length > 160 || !unit || unit.length > 40 || !stockUnit || stockUnit.length > 40
      || !Number.isFinite(quantityUsed) || quantityUsed <= 0
      || Number(quantityUsed.toFixed(6)) !== quantityUsed) {
      throw httpError(400, `${description} needs a name, stock unit, recipe unit, and positive amount with at most 6 decimal places.`);
    }
    return { name, unit, stockUnit, quantityUsed };
  });
}

function assertNoDuplicateRecipeNames(entries, description) {
  if (new Set(entries.map((entry) => entry.name.toLocaleLowerCase())).size !== entries.length) {
    throw httpError(400, `${description} ingredient names can only appear once.`);
  }
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
    const [existing] = await connection.execute("SELECT id FROM menu_products WHERE id = ? AND is_archived = FALSE", [id]);
    if (!existing.length) throw httpError(404, "Menu item not found.");
    await connection.execute(
      `UPDATE menu_products SET category_id = ?, name = ?, description = ?, image_url = ?, base_price = ?, stock_quantity = ?, is_available = ?, is_featured = ? WHERE id = ?`,
      [...values, id],
    );
  }

  const rawSizes = Array.isArray(body.sizes) && body.sizes.length ? body.sizes : [{ label: "Regular", price: basePrice }];
  const sizes = rawSizes.map((size) => {
    if (typeof size === "string") {
      const [label, rawPrice] = size.split(":");
      return { label, price: rawPrice?.trim() ? rawPrice : basePrice, ingredients: undefined };
    }
    return size;
  });
  const addons = Array.isArray(body.addons) ? body.addons : [];
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
  if (sizes.length > 20 || addons.length > 50 || ingredients.length > 100) throw httpError(400, "This menu item has too many sizes, add-ons, or ingredients.");
  const seenSizeLabels = new Set();
  sizes.forEach((size) => {
    const label = String(size?.label || "").trim();
    if (!label || label.length > 80 || seenSizeLabels.has(label.toLocaleLowerCase())) throw httpError(400, "Each serving size needs a unique label (up to 80 characters).");
    seenSizeLabels.add(label.toLocaleLowerCase());
    toMoney(size.price ?? basePrice, `Price for ${label}`);
  });

  const recipeInputs = normalizeRecipeEntries(ingredients, "Each default recipe ingredient");
  assertNoDuplicateRecipeNames(recipeInputs, "Default recipe");
  const sizeRecipeInputs = sizes.map((size) => {
    const entries = size.ingredients === undefined ? recipeInputs : normalizeRecipeEntries(size.ingredients, `The ${String(size.label).trim()} recipe`);
    assertNoDuplicateRecipeNames(entries, `The ${String(size.label).trim()} recipe`);
    if (entries.length !== recipeInputs.length || entries.some((entry) => !recipeInputs.some((base) => base.name.toLocaleLowerCase() === entry.name.toLocaleLowerCase()))) {
      throw httpError(400, `Each serving size must use the same ingredient list as the default recipe.`);
    }
    return entries;
  });
  const addonInputs = addons.map((addon) => {
    const label = String(addon?.label || "").trim();
    const unit = String(addon?.unit || "pcs").trim();
    const stockUnit = String(addon?.stockUnit || unit).trim();
    const rawQuantity = String(addon?.quantityUsed ?? "").trim();
    const attachedAmount = rawQuantity.match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
    if (attachedAmount) throw httpError(400, `For “${label || "this add-on"}”, enter only ${attachedAmount[1]} in Amount per serving and “${attachedAmount[2]}” in Recipe unit.`);
    const quantityUsed = Number(addon?.quantityUsed);
    const packedUnitError = explainPackedUnit(label || "this add-on", unit, "recipe")
      || explainPackedUnit(label || "this add-on", stockUnit, "stock");
    if (packedUnitError) throw httpError(400, packedUnitError);
    if (!label || label.length > 100 || !unit || unit.length > 40 || !stockUnit || stockUnit.length > 40
      || !Number.isFinite(quantityUsed) || quantityUsed <= 0
      || Number(quantityUsed.toFixed(6)) !== quantityUsed) {
      throw httpError(400, "Each add-on needs a name, price, stock unit, recipe unit, and positive usage amount with at most 6 decimal places.");
    }
    return { label, unit, stockUnit, quantityUsed, price: toMoney(addon.price ?? 0, "Add-on price") };
  });
  if (new Set(addonInputs.map((entry) => entry.label.toLocaleLowerCase())).size !== addonInputs.length) {
    throw httpError(400, "Each add-on name can only appear once per menu item.");
  }

  const ensureInventoryItem = async (itemName, stockUnit, itemCategory) => {
    let result;
    try {
      [result] = await connection.execute(
        `INSERT INTO inventory_items (name, category, quantity, unit, maximum_stock, added_from_menu, is_archived, archived_at, archived_by)
         VALUES (?, ?, 0, ?, NULL, TRUE, FALSE, NULL, NULL)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), is_archived = FALSE, archived_at = NULL, archived_by = NULL`,
        [itemName, itemCategory, stockUnit],
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
    const packedStockUnitError = explainPackedUnit(itemName, inventoryItem.unit, "stock");
    if (packedStockUnitError) throw httpError(400, packedStockUnitError);
    return inventoryItem;
  };

  const recipeItems = [];
  for (const entry of recipeInputs) {
    const item = await ensureInventoryItem(entry.name, entry.stockUnit, "Supplies");
    if (!toInventoryQuantity(entry.quantityUsed, entry.unit, item.unit)) {
      throw httpError(400, `“${entry.unit}” for ${entry.name} cannot be converted to inventory unit “${item.unit}”. Choose units from the same group (weight, volume, or count).`);
    }
    recipeItems.push({ ...entry, inventoryItemId: Number(item.id), stockUnit: item.unit });
  }
  const addonInventoryItems = [];
  for (const entry of addonInputs) {
    const item = await ensureInventoryItem(entry.label, entry.stockUnit, "Toppings");
    if (!toInventoryQuantity(entry.quantityUsed, entry.unit, item.unit)) {
      throw httpError(400, `“${entry.unit}” for ${entry.label} cannot be converted to inventory unit “${item.unit}”. Choose units from the same group (weight, volume, or count).`);
    }
    addonInventoryItems.push({ ...entry, inventoryItemId: Number(item.id), stockUnit: item.unit });
  }

  await connection.execute("DELETE FROM product_sizes WHERE product_id = ?", [productId]);
  await connection.execute("DELETE FROM product_addons WHERE product_id = ?", [productId]);
  await connection.execute("DELETE FROM product_ingredients WHERE product_id = ?", [productId]);

  const recipeByName = new Map(recipeItems.map((entry) => [entry.name.toLocaleLowerCase(), entry]));
  for (const [index, size] of sizes.entries()) {
    const label = String(size?.label || "").trim();
    if (!label) continue;
    const [createdSize] = await connection.execute("INSERT INTO product_sizes (product_id, label, price, display_order) VALUES (?, ?, ?, ?)", [productId, label.slice(0, 80), toMoney(size.price ?? basePrice, `Price for ${label}`), index]);
    const sizeIngredients = sizeRecipeInputs[index] || [];
    for (const entry of sizeIngredients) {
      const base = recipeByName.get(entry.name.toLocaleLowerCase());
      if (!base) throw httpError(400, `The ${label} recipe contains an ingredient missing from the default recipe.`);
      const quantityUsed = toInventoryQuantity(entry.quantityUsed, entry.unit, base.stockUnit);
      if (!quantityUsed) throw httpError(400, `The ${label} quantity for ${entry.name} cannot be converted to its Inventory stock unit “${base.stockUnit}”.`);
      await connection.execute(
        "INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit) VALUES (?, ?, ?, ?)",
        [createdSize.insertId, base.inventoryItemId, entry.quantityUsed, entry.unit],
      );
    }
  }
  for (const [index, addon] of addonInventoryItems.entries()) {
    await connection.execute(
      "INSERT INTO product_addons (product_id, label, price, inventory_item_id, quantity_used, usage_unit, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [productId, addon.label, addon.price, addon.inventoryItemId, addon.quantityUsed, addon.unit, index],
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
  const includeInventory = Boolean(request.authUser && ["admin", "staff"].includes(request.authUser.role));
  response.json(await listProducts(includeUnavailable, includeInventory));
});

router.post("/", requireAuth, requireRole("admin"), async (request, response) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const id = await saveProduct(connection, request.body);
    await connection.commit();
    response.status(201).json((await listProducts(true, true)).find((product) => product.id === Number(id)));
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
    response.json((await listProducts(true, true)).find((product) => product.id === id));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

router.delete("/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = idFrom(request.params.id);
  const [[existing]] = await pool.execute(
    `SELECT p.id, p.name, p.base_price, c.name AS category
       FROM menu_products p LEFT JOIN menu_categories c ON c.id = p.category_id
      WHERE p.id = ? AND p.is_archived = FALSE`,
    [id],
  );
  if (!existing) throw httpError(404, "Menu item not found.");
  await pool.execute(
    "UPDATE menu_products SET is_archived = TRUE, archived_at = NOW(), archived_by = ? WHERE id = ?",
    [request.authUser?.sub || null, id],
  );
  await recordArchiveAudit(pool, {
    entityType: "menu_product",
    entityId: id,
    entityName: existing.name,
    action: "archived",
    actorId: request.authUser?.sub || null,
    actorName: request.authUser?.username || "Admin",
    note: "Moved to 30-day Archive from Menu Management",
    metadata: { category: existing.category || "Uncategorized", basePrice: Number(existing.base_price) },
  });
  response.status(204).end();
});

export default router;
