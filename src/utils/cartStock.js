import {
  findProductById,
  parseMenuPrice,
  resolveProductAddons,
  resolveProductSizes,
} from "./menuCatalogHelpers.js";

export function normalizeBaseSizeLabel(label) {
  const cleaned = String(label || "Regular")
    .replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:fl\s*)?oz\s*\)\s*$/i, "")
    .trim()
    .toLowerCase();
  return cleaned || "regular";
}

export function getDefaultProductSize(product) {
  const sizes = resolveProductSizes(product);
  return (
    sizes[0] || {
      label: "Regular",
      price: parseMenuPrice(product?.price),
      ingredients: Array.isArray(product?.ingredients) ? product.ingredients : [],
    }
  );
}

export function findMatchingSizeOption(sizeOptions = [], sizeLabel = "Regular", { fallbackToFirst = false } = {}) {
  if (!Array.isArray(sizeOptions) || sizeOptions.length === 0) return null;
  const targetExact = String(sizeLabel || "Regular").trim().toLowerCase();
  const exactMatch = sizeOptions.find(
    (s) => String(s?.label || "").trim().toLowerCase() === targetExact,
  );
  if (exactMatch) return exactMatch;

  const targetBase = normalizeBaseSizeLabel(sizeLabel);
  const baseMatches = sizeOptions.filter(
    (s) => normalizeBaseSizeLabel(s?.label) === targetBase,
  );
  if (baseMatches.length === 1) return baseMatches[0];

  return fallbackToFirst ? (sizeOptions[0] || null) : null;
}

export function getCartIngredientUsage(cartItems = [], catalogProducts = []) {
  const usedMap = new Map();
  if (!Array.isArray(cartItems)) return usedMap;

  cartItems.forEach((cartItem) => {
    const itemQty = Number(cartItem?.quantity || 0);
    if (!(itemQty > 0)) return;

    const matchedCatalog =
      (cartItem.productId != null && findProductById(catalogProducts, cartItem.productId)) ||
      catalogProducts.find((p) => (p.name || p.title) === cartItem.title) ||
      cartItem;
    if (!matchedCatalog) return;

    const itemSizes = resolveProductSizes(matchedCatalog);
    const itemAddons = resolveProductAddons(matchedCatalog);
    const matchedSize = findMatchingSizeOption(itemSizes, cartItem.size || "Regular", { fallbackToFirst: true });

    const itemEntries = [
      ...(matchedSize?.ingredients || matchedCatalog.ingredients || []),
      ...(Array.isArray(cartItem.addons)
        ? cartItem.addons.map((label) => itemAddons.find((a) => a.label === label)).filter(Boolean)
        : []),
    ];

    itemEntries.forEach((entry) => {
      const invId = Number(entry?.inventoryItemId);
      const perServing = Number(entry?.quantityInStockUnit);
      if (Number.isFinite(invId) && invId > 0 && Number.isFinite(perServing) && perServing > 0) {
        const key = String(invId);
        usedMap.set(key, (usedMap.get(key) || 0) + perServing * itemQty);
      }
    });
  });

  return usedMap;
}

export function buildIngredientStockLines({
  catalogProduct,
  sizeObj,
  selectedAddons = [],
  addonOptions = [],
  cartUsedByIngredientId = new Map(),
  quantity = 1,
}) {
  const combined = new Map();
  const entries = [
    ...(sizeObj?.ingredients || catalogProduct?.ingredients || []),
    ...selectedAddons.map((label) => addonOptions.find((addon) => addon.label === label)).filter(Boolean),
  ];

  entries.forEach((entry) => {
    const itemId = Number(entry.inventoryItemId);
    const perServing = Number(entry.quantityInStockUnit);
    const key = Number.isFinite(itemId) && itemId > 0 ? String(itemId) : `missing:${entry.name || entry.label}`;
    const alreadyUsed = Number.isFinite(itemId) && itemId > 0 ? (cartUsedByIngredientId.get(key) || 0) : 0;
    const effectiveInventory = Math.max(0, Number(entry.inventoryQuantity || 0) - alreadyUsed);
    const current = combined.get(key) || {
      id: Number.isFinite(itemId) && itemId > 0 ? itemId : null,
      name: entry.name || entry.label || "Inventory item",
      unit: entry.stockUnit || "pcs",
      inventoryQuantity: Number(effectiveInventory.toFixed(6)),
      perServing: 0,
      configured: Number.isFinite(itemId) && itemId > 0 && Number.isFinite(perServing) && perServing > 0,
    };
    current.perServing += Number.isFinite(perServing) && perServing > 0 ? perServing : 0;
    combined.set(key, current);
  });

  return [...combined.values()].map((entry) => ({
    ...entry,
    required: Number((entry.perServing * quantity).toFixed(6)),
    availableAfter: Number((entry.inventoryQuantity - entry.perServing * quantity).toFixed(6)),
  }));
}

export function canFulfillCartAddition({
  cartItems = [],
  catalogProducts = [],
  targetProduct,
  sizeLabel,
  addons = [],
  addQuantity = 1,
}) {
  const matchedCatalog =
    (targetProduct?.id != null && findProductById(catalogProducts, targetProduct.id)) ||
    (targetProduct?.productId != null && findProductById(catalogProducts, targetProduct.productId)) ||
    catalogProducts.find((p) => (p.name || p.title) === (targetProduct?.title || targetProduct?.name)) ||
    targetProduct;

  if (!matchedCatalog) {
    return { allowed: false, maxAdditionalQty: 0, shortages: [] };
  }

  const sizeOptions = resolveProductSizes(matchedCatalog);
  const addonOptions = resolveProductAddons(matchedCatalog);
  const sizeObj = findMatchingSizeOption(sizeOptions, sizeLabel || getDefaultProductSize(matchedCatalog).label);
  if (sizeOptions.length > 0 && sizeLabel && !sizeObj) {
    return { allowed: false, maxAdditionalQty: 0, shortages: [] };
  }
  const cartUsedByIngredientId = getCartIngredientUsage(cartItems, catalogProducts);

  const stockLines = buildIngredientStockLines({
    catalogProduct: matchedCatalog,
    sizeObj,
    selectedAddons: addons,
    addonOptions,
    cartUsedByIngredientId,
    quantity: addQuantity,
  });

  const hasBaseRecipe = Boolean(
    (sizeObj?.ingredients && sizeObj.ingredients.length > 0)
    || (matchedCatalog?.ingredients && matchedCatalog.ingredients.length > 0),
  );
  const alreadyInCartForProduct = cartItems
    .filter((entry) => entry.productId === matchedCatalog.id || entry.title === (matchedCatalog.name || matchedCatalog.title))
    .reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
  const rawCatalogStock = matchedCatalog.stock;
  const maxCatalogStock = rawCatalogStock !== undefined && rawCatalogStock !== null && Number.isFinite(Number(rawCatalogStock))
    ? Math.max(0, Math.floor((Number(rawCatalogStock) - alreadyInCartForProduct) + 1e-9))
    : Infinity;

  if (!stockLines.length) {
    return {
      allowed: maxCatalogStock >= addQuantity,
      maxAdditionalQty: maxCatalogStock,
      shortages: [],
    };
  }

  const ingredientMaxQty = stockLines.reduce((minServings, entry) => {
    if (!entry.configured || !(entry.perServing > 0)) return 0;
    return Math.min(minServings, Math.floor((entry.inventoryQuantity / entry.perServing) + 1e-9));
  }, Infinity);

  const maxAdditionalQty = hasBaseRecipe
    ? ingredientMaxQty
    : Math.min(ingredientMaxQty, maxCatalogStock);

  const shortages = stockLines.filter((entry) => !entry.configured || entry.availableAfter < -1e-9);
  return {
    allowed: shortages.length === 0 && maxAdditionalQty >= addQuantity,
    maxAdditionalQty,
    shortages,
  };
}
