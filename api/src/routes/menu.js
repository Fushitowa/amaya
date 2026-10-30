import { Router } from "express";
import pool from "../database.js";
import { httpError, optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { calculateLineCost, summarizeCosting } from "../utils/costing.js";
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
		return `For â€œ${name}â€, the Inventory stock unit is â€œ${value}â€. Edit the inventory item and enter ${match[1]} as its stock quantity and â€œ${match[2]}â€ as its unit.`;
	}
	return `For â€œ${name}â€, put ${match[1]} in Amount per serving and â€œ${match[2]}â€ in Recipe unit. Keep the amount and unit in separate fields.`;
};

export function toProduct(row, sizes, addons, ingredients, sizeIngredients, includeInventory) {
  const mapIngredient = (entry) => {
    const line = includeInventory
      ? calculateLineCost(entry.quantity_used, entry.unit || entry.inventory_unit, entry.inventory_unit, entry.unit_cost)
      : null;
    return {
      inventoryItemId: Number(entry.inventory_item_id),
      name: entry.name,
      quantityUsed: entry.quantity_used == null ? null : Number(entry.quantity_used),
      unit: entry.unit || entry.inventory_unit,
      stockUnit: entry.inventory_unit,
      quantityInStockUnit: entry.quantity_used == null ? null : toInventoryQuantity(entry.quantity_used, entry.unit || entry.inventory_unit, entry.inventory_unit),
      ...(includeInventory ? {
        inventoryQuantity: Number(entry.inventory_quantity),
        maximumStock: entry.maximum_stock == null ? null : Number(entry.maximum_stock),
        unitCost: Number(entry.unit_cost || 0),
        lineCost: line.cost,
        costComplete: line.complete,
      } : {}),
    };
  };
  // Servings a recipe can still make from live inventory (the scarcest ingredient decides).
  const recipeServings = (rows) => Math.min(...rows.map((entry) => {
    const perServing = toInventoryQuantity(entry.quantity_used, entry.unit || entry.inventory_unit, entry.inventory_unit);
    const available = Number(entry.inventory_quantity || 0);
    return perServing && perServing > 0 ? Math.max(0, Math.floor((available + 1e-9) / perServing)) : 0;
  }));
  const rawIngredients = ingredients.filter((entry) => Number(entry.product_id) === Number(row.id));
  const productIngredients = rawIngredients.map(mapIngredient);
  const productSizes = sizes
    .filter((entry) => Number(entry.product_id) === Number(row.id))
    .map((size) => {
      // A size with its own rows uses them exclusively (same rule as orders.js); a size with none uses the base recipe.
      const ownRows = sizeIngredients.filter((entry) => Number(entry.product_size_id) === Number(size.id));
      const recipeRows = ownRows.length ? ownRows : rawIngredients;
      const recipes = ownRows.length ? ownRows.map(mapIngredient) : productIngredients;
      const sizeCostSummary = includeInventory
        ? summarizeCosting(size.price, recipes.map((recipe) => ({ cost: recipe.lineCost, complete: recipe.costComplete })))
        : null;
      return {
        label: size.label,
        price: Number(size.price),
        stock: recipeRows.length ? recipeServings(recipeRows) : Number(row.stock_quantity),
        ingredients: recipes,
        ...(sizeCostSummary ? sizeCostSummary : {}),
      };
    });
  const primarySize =
    productSizes.find(
      (s) =>
        String(s.label || "")
          .replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:fl\s*)?oz\s*\)\s*$/i, "")
          .trim()
          .toLowerCase() === "regular",
    ) || productSizes[0];
  const effectiveStock = productSizes.length
    ? Math.max(...productSizes.map((s) => s.stock))
    : rawIngredients.length ? recipeServings(rawIngredients) : Number(row.stock_quantity);
  const baseCostSummary = includeInventory && rawIngredients.length
    ? summarizeCosting(row.base_price, productIngredients.map((r) => ({ cost: r.lineCost, complete: r.costComplete })))
    : null;
  const activeCostSummary = primarySize || baseCostSummary;
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category || "Uncategorized",
    price: `₱${Number(row.base_price).toFixed(2)}`,
    image: row.image_url || "",
    description: row.description || "",
    stock: effectiveStock,
    available: Boolean(row.is_available),
    featured: Boolean(row.is_featured),
    ...(includeInventory ? {
      cost: activeCostSummary?.cost ?? 0,
      costComplete: Boolean(activeCostSummary?.costComplete),
      grossProfit: activeCostSummary?.grossProfit ?? null,
      margin: activeCostSummary?.margin ?? null,
      foodCostPercent: activeCostSummary?.foodCostPercent ?? null,
      suggestedPrice: activeCostSummary?.suggestedPrice ?? null,
    } : {}),
    sizes: productSizes,
    addons: addons.filter((entry) => Number(entry.product_id) === Number(row.id)).map((entry) => {
      const addonLine = includeInventory
        ? calculateLineCost(entry.quantity_used, entry.usage_unit || entry.inventory_unit, entry.inventory_unit, entry.unit_cost)
        : null;
      const addonSummary = includeInventory ? summarizeCosting(entry.price, [addonLine]) : null;
      return {
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
          unitCost: Number(entry.unit_cost || 0),
          cost: addonSummary.cost,
          costComplete: addonSummary.costComplete,
          grossProfit: addonSummary.grossProfit,
          margin: addonSummary.margin,
        } : {}),
      };
    }),
    ingredients: productIngredients,
  };
}

// db defaults to the shared pool; tests pass a transaction connection.
export async function listProducts(includeUnavailable = false, includeInventory = false, db = pool) {
  const [products] = await db.execute(
    `SELECT p.*, c.name AS category
       FROM menu_products p LEFT JOIN menu_categories c ON c.id = p.category_id
      WHERE p.is_archived = FALSE ${includeUnavailable ? "" : "AND p.is_available = TRUE"}
      ORDER BY p.display_order, p.name`,
  );
  if (!products.length) return [];
  const ids = products.map((product) => product.id);
  const marks = ids.map(() => "?").join(",");
  const [addonResult, ingredientResult, sizeResult] = await Promise.all([
    db.execute(`SELECT pa.product_id, pa.label, pa.price, pa.inventory_item_id, pa.quantity_used, pa.usage_unit, i.unit AS inventory_unit, i.quantity AS inventory_quantity, i.maximum_stock, i.unit_cost FROM product_addons pa LEFT JOIN inventory_items i ON i.id = pa.inventory_item_id WHERE pa.product_id IN (${marks}) ORDER BY pa.display_order, pa.id`, ids),
    db.execute(`SELECT pi.product_id, pi.inventory_item_id, pi.quantity_used, pi.unit, i.name, i.unit AS inventory_unit, i.quantity AS inventory_quantity, i.maximum_stock, i.unit_cost FROM product_ingredients pi JOIN inventory_items i ON i.id = pi.inventory_item_id WHERE pi.product_id IN (${marks}) ORDER BY pi.id`, ids),
    db.execute(`SELECT ps.product_id, ps.id, ps.label, ps.price FROM product_sizes ps WHERE ps.product_id IN (${marks}) ORDER BY ps.display_order, ps.id`, ids),
  ]);
  const addonRows = addonResult[0];
  const ingredientRows = ingredientResult[0];
  const sizeRows = sizeResult[0];
  const sizeIds = sizeRows.map((size) => size.id);
  let sizeIngredients = [];
  if (sizeIds.length) {
    const sizeMarks = sizeIds.map(() => "?").join(",");
    const [rows] = await db.execute(
      `SELECT psi.product_size_id, psi.inventory_item_id, psi.quantity_used, psi.unit,
              i.name, i.unit AS inventory_unit, i.quantity AS inventory_quantity, i.maximum_stock, i.unit_cost
         FROM product_size_ingredients psi JOIN inventory_items i ON i.id = psi.inventory_item_id
        WHERE psi.product_size_id IN (${sizeMarks}) ORDER BY psi.id`, sizeIds,
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
    if (attachedAmount) throw httpError(400, `For â€œ${name || "this ingredient"}â€, enter only ${attachedAmount[1]} in Amount per serving and â€œ${attachedAmount[2]}â€ in Recipe unit.`);
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

const isCupItem = (item) => Boolean(item?.is_cup_category || item?.isCupCategory) || /cup/i.test(String(item?.category || "")) || /cup/i.test(String(item?.name || ""));

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
    // A size may use its own ingredients (e.g. its own cup), but must not end up with none, or it would silently fall back to the base recipe.
    if (recipeInputs.length && !entries.length) {
      throw httpError(400, `The ${String(size.label).trim()} size needs at least one ingredient.`);
    }
    return entries;
  });
  const addonInputs = addons.map((addon) => {
    const label = String(addon?.label || "").trim();
    const unit = String(addon?.unit || "pcs").trim();
    const stockUnit = String(addon?.stockUnit || unit).trim();
    const rawQuantity = String(addon?.quantityUsed ?? "").trim();
    const attachedAmount = rawQuantity.match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
    if (attachedAmount) throw httpError(400, `For â€œ${label || "this add-on"}â€, enter only ${attachedAmount[1]} in Amount per serving and â€œ${attachedAmount[2]}â€ in Recipe unit.`);
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
      if (error.code === "ER_DUP_ENTRY") throw httpError(409, `Inventory already has â€œ${itemName}â€ with a different spelling or name conflict. Check its existing entry.`);
      throw error;
    }
    const inventoryItemId = Number(result.insertId);
    const [[inventoryItem]] = await connection.execute(
      "SELECT id, name, unit FROM inventory_items WHERE id = ? FOR UPDATE", [inventoryItemId],
    );
    if (!inventoryItem) throw httpError(409, `Could not find the Inventory item for â€œ${itemName}â€.`);
    const packedStockUnitError = explainPackedUnit(itemName, inventoryItem.unit, "stock");
    if (packedStockUnitError) throw httpError(400, packedStockUnitError);
    return inventoryItem;
  };

  // Resolve every ingredient used by the default recipe AND any size-specific recipe once.
  const itemByName = new Map();
  for (const entry of [...recipeInputs, ...sizeRecipeInputs.flat()]) {
    const key = entry.name.toLocaleLowerCase();
    if (!itemByName.has(key)) {
      let item = null;
      if (entry.inventoryItemId) {
        const [[byId]] = await connection.execute(
          "SELECT id, name, unit, category FROM inventory_items WHERE id = ? AND is_archived = FALSE LIMIT 1 FOR UPDATE",
          [entry.inventoryItemId],
        );
        item = byId;
      }
      if (!item) {
        const [byName] = await connection.execute(
          "SELECT id, name, unit, category FROM inventory_items WHERE LOWER(name) = LOWER(?) AND is_archived = FALSE LIMIT 1 FOR UPDATE",
          [entry.name],
        );
        item = byName[0];
      }
      if (!item) {
        const isCup = /cup/i.test(entry.name);
        const [[catRow]] = await connection.execute(
          isCup
            ? "SELECT name FROM inventory_categories WHERE is_cup_category = TRUE ORDER BY display_order ASC, id ASC LIMIT 1"
            : "SELECT name FROM inventory_categories WHERE is_cup_category = FALSE ORDER BY display_order ASC, id ASC LIMIT 1",
        );
        const resolvedCategory = catRow?.name || (isCup ? "Cups" : "Ingredients");
        item = { ...(await ensureInventoryItem(entry.name, entry.stockUnit, resolvedCategory)), category: resolvedCategory };
      }
      itemByName.set(key, { inventoryItemId: Number(item.id), stockUnit: item.unit, itemName: item.name, isCup: isCupItem(item) });
    }
    if (!toInventoryQuantity(entry.quantityUsed, entry.unit, itemByName.get(key).stockUnit)) {
      throw httpError(400, `â€œ${entry.unit}â€ for ${entry.name} cannot be converted to inventory unit â€œ${itemByName.get(key).stockUnit}â€. Choose units from the same group (weight, volume, or count).`);
    }
  }
  const recipeItems = recipeInputs.map((entry) => ({ ...entry, ...itemByName.get(entry.name.toLocaleLowerCase()) }));
  const addonInventoryItems = [];
  for (const entry of addonInputs) {
    const strippedName = entry.label.replace(/^extra\s+/i, "").trim();
    const [existingBaseRows] =
      strippedName && strippedName.toLocaleLowerCase() !== entry.label.toLocaleLowerCase()
        ? await connection.execute(
            "SELECT id, name, unit FROM inventory_items WHERE LOWER(name) = LOWER(?) AND is_archived = FALSE LIMIT 1 FOR UPDATE",
            [strippedName],
          )
        : [[]];
    const [[defaultCatRow]] = await connection.execute(
      "SELECT name FROM inventory_categories ORDER BY display_order ASC, id ASC LIMIT 1",
    );
    const fallbackAddonCat = defaultCatRow?.name || "Ingredients";
    const item = existingBaseRows[0] || (await ensureInventoryItem(entry.label, entry.stockUnit, fallbackAddonCat));
    if (!toInventoryQuantity(entry.quantityUsed, entry.unit, item.unit)) {
      throw httpError(400, `â€œ${entry.unit}â€ for ${entry.label} cannot be converted to inventory unit â€œ${item.unit}â€. Choose units from the same group (weight, volume, or count).`);
    }
    addonInventoryItems.push({ ...entry, inventoryItemId: Number(item.id), stockUnit: item.unit });
  }

  await connection.execute("DELETE FROM product_sizes WHERE product_id = ?", [productId]);
  await connection.execute("DELETE FROM product_addons WHERE product_id = ?", [productId]);
  await connection.execute("DELETE FROM product_ingredients WHERE product_id = ?", [productId]);

  for (const [index, size] of sizes.entries()) {
    const label = String(size?.label || "").trim();
    if (!label) continue;
    const [createdSize] = await connection.execute(
      "INSERT INTO product_sizes (product_id, label, price, display_order) VALUES (?, ?, ?, ?)",
      [productId, label.slice(0, 80), toMoney(size.price ?? basePrice, `Price for ${label}`), index],
    );
    const sizeIngredients = sizeRecipeInputs[index] || [];
    for (const entry of sizeIngredients) {
      const base = itemByName.get(entry.name.toLocaleLowerCase());
      const quantityUsed = toInventoryQuantity(entry.quantityUsed, entry.unit, base.stockUnit);
      if (!quantityUsed) throw httpError(400, `The ${label} quantity for ${entry.name} cannot be converted to its Inventory stock unit â€œ${base.stockUnit}â€.`);
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

const VALID_OPERATIONAL_FAMILIES = ["drink", "fries", "snack_pieces", "single_fixed", "general"];

router.get("/categories", optionalAuth, async (request, response) => {
  const showAll = Boolean(request.authUser && ["admin", "staff"].includes(request.authUser.role))
    && request.query.all === "true";

  const [rows] = await pool.execute(
    `SELECT c.id, c.name, c.description, c.operational_family AS operationalFamily,
            c.display_order AS displayOrder, c.is_active AS isActive,
            COUNT(p.id) AS productCount
       FROM menu_categories c
       LEFT JOIN menu_products p ON p.category_id = c.id AND p.is_archived = FALSE
      WHERE (? = 1 OR c.is_active = TRUE)
      GROUP BY c.id
      ORDER BY c.display_order ASC, c.name ASC`,
    [showAll ? 1 : 0],
  );
  response.json(rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    operationalFamily: row.operationalFamily || "general",
    displayOrder: Number(row.displayOrder || 0),
    isActive: Boolean(row.isActive),
    productCount: Number(row.productCount || 0),
  })));
});

router.post("/categories", requireAuth, requireRole("admin"), async (request, response) => {
  const name = String(request.body?.name || "").trim().slice(0, 100);
  if (!name) throw httpError(400, "Category name is required.");

  const description = String(request.body?.description || "").trim().slice(0, 500) || null;
  const rawFamily = String(request.body?.operationalFamily || "general").trim().toLowerCase();
  const operationalFamily = VALID_OPERATIONAL_FAMILIES.includes(rawFamily) ? rawFamily : "general";
  const displayOrder = Number.isInteger(Number(request.body?.displayOrder)) && Number(request.body?.displayOrder) >= 0
    ? Number(request.body.displayOrder)
    : 0;
  const isActive = request.body?.isActive === false ? 0 : 1;

  try {
    const [result] = await pool.execute(
      `INSERT INTO menu_categories (name, description, operational_family, display_order, is_active)
       VALUES (?, ?, ?, ?, ?)`,
      [name, description, operationalFamily, displayOrder, isActive],
    );

    response.status(201).json({
      id: Number(result.insertId),
      name,
      description: description || "",
      operationalFamily,
      displayOrder,
      isActive: Boolean(isActive),
      productCount: 0,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw httpError(409, `A menu category named “${name}” already exists.`);
    }
    throw error;
  }
});

router.put("/categories/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = idFrom(request.params.id);
  const name = String(request.body?.name || "").trim().slice(0, 100);
  if (!name) throw httpError(400, "Category name cannot be empty.");

  const [[existing]] = await pool.execute("SELECT id, name FROM menu_categories WHERE id = ?", [id]);
  if (!existing) throw httpError(404, "Menu category not found.");

  const description = request.body?.description !== undefined
    ? (String(request.body.description || "").trim().slice(0, 500) || null)
    : null;
  const rawFamily = String(request.body?.operationalFamily || "general").trim().toLowerCase();
  const operationalFamily = VALID_OPERATIONAL_FAMILIES.includes(rawFamily) ? rawFamily : "general";
  const displayOrder = Number.isInteger(Number(request.body?.displayOrder)) && Number(request.body?.displayOrder) >= 0
    ? Number(request.body.displayOrder)
    : 0;
  const isActive = request.body?.isActive === false ? 0 : 1;

  try {
    await pool.execute(
      `UPDATE menu_categories
          SET name = ?, description = ?, operational_family = ?, display_order = ?, is_active = ?
        WHERE id = ?`,
      [name, description, operationalFamily, displayOrder, isActive, id],
    );

    const [[countRow]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM menu_products WHERE category_id = ? AND is_archived = FALSE",
      [id],
    );

    response.json({
      id,
      name,
      description: description || "",
      operationalFamily,
      displayOrder,
      isActive: Boolean(isActive),
      productCount: Number(countRow?.total || 0),
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw httpError(409, `A menu category named “${name}” already exists.`);
    }
    throw error;
  }
});

router.delete("/categories/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const id = idFrom(request.params.id);
  const [[category]] = await pool.execute("SELECT id, name FROM menu_categories WHERE id = ?", [id]);
  if (!category) throw httpError(404, "Menu category not found.");

  // Charlotte's Zero-Trust Referential Integrity Guard (checks active and archived products)
  const [[usage]] = await pool.execute(
    "SELECT COUNT(*) AS total FROM menu_products WHERE category_id = ?",
    [id],
  );
  if (usage.total > 0) {
    throw httpError(409, `Cannot delete category “${category.name}”: ${usage.total} product(s) (including archived items) are assigned to it. Reassign or remove them first.`);
  }

  await pool.execute("DELETE FROM menu_categories WHERE id = ?", [id]);
  response.json({ message: `Menu category “${category.name}” deleted successfully.`, id });
});

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
