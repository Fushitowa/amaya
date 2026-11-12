export const DEFAULT_TARGET_FOOD_COST = 0.30;
export const MIN_TARGET_FOOD_COST = 0.10;
export const MAX_TARGET_FOOD_COST = 0.90;

export function normalizeTargetFoodCost(value, fallback = DEFAULT_TARGET_FOOD_COST) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "object"
  ) {
    return fallback;
  }
  if (typeof value === "string" && !value.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= MIN_TARGET_FOOD_COST && parsed <= MAX_TARGET_FOOD_COST
    ? Number(parsed.toFixed(4))
    : fallback;
}

export const unitFactors = new Map();
const registerUnit = (dimension, factorToBase, units) =>
  units.forEach((unit) => unitFactors.set(unit.toLowerCase(), { dimension, factorToBase }));

registerUnit("mass", 0.000001, ["µg", "μg", "ug", "mcg", "microgram", "micrograms"]);
registerUnit("mass", 0.001, ["mg", "milligram", "milligrams"]);
registerUnit("mass", 1, ["g", "gram", "grams"]);
registerUnit("mass", 100, ["hg", "hectogram", "hectograms"]);
registerUnit("mass", 1000, ["kg", "kilogram", "kilograms"]);
registerUnit("mass", 1000000, ["t", "tonne", "tonnes", "metric ton", "metric tons"]);
registerUnit("mass", 28.349523125, ["oz", "ounce", "ounces"]);
registerUnit("mass", 453.59237, ["lb", "lbs", "pound", "pounds"]);
registerUnit("volume", 1, ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc", "cm3", "cm³"]);
registerUnit("volume", 10, ["cl", "centiliter", "centiliters", "centilitre", "centilitres"]);
registerUnit("volume", 100, ["dl", "deciliter", "deciliters", "decilitre", "decilitres"]);
registerUnit("volume", 1000, ["l", "liter", "liters", "litre", "litres"]);
registerUnit("volume", 4.92892159375, ["tsp", "teaspoon", "teaspoons"]);
registerUnit("volume", 14.78676478125, ["tbsp", "tablespoon", "tablespoons"]);
registerUnit("volume", 236.5882365, ["cup", "cups"]);
registerUnit("volume", 29.5735295625, ["fl oz", "fluid ounce", "fluid ounces"]);
registerUnit("volume", 473.176473, ["pt", "pint", "pints"]);
registerUnit("volume", 946.352946, ["qt", "quart", "quarts"]);
registerUnit("volume", 3785.411784, ["gal", "gallon", "gallons"]);
registerUnit("count", 1, ["pc", "pcs", "piece", "pieces", "ea", "each", "unit", "units"]);
registerUnit("count", 1, ["can", "cans"]);
registerUnit("count", 2, ["pair", "pairs"]);
registerUnit("count", 12, ["dozen", "doz"]);

export const safeLower = (val) => String(val || "").trim().toLowerCase();

export const safeItemName = (entry) => String(entry?.item ?? entry?.name ?? "").trim();

export const safeToFixed = (val, fractionDigits = 2, fallback = "0.00") => {
  const num = Number(val);
  return Number.isFinite(num) ? num.toFixed(fractionDigits) : fallback;
};

export const findInventoryItemInList = (inventoryList, query, id = null) => {
  if (!Array.isArray(inventoryList)) return undefined;
  const numericId = id != null && !Number.isNaN(Number(id)) ? Number(id) : null;
  const clean = safeLower(query);
  return inventoryList.find((entry) => {
    if (!entry) return false;
    if (numericId !== null && Number(entry.id) === numericId) return true;
    if (!clean) return false;
    return safeLower(safeItemName(entry)) === clean;
  });
};

export const convertRecipeAmount = (amount, recipeUnit, stockUnit) => {
  const sourceName = safeLower(recipeUnit);
  const targetName = safeLower(stockUnit);
  const quantity = Number(amount);
  const source = unitFactors.get(sourceName);
  const target = unitFactors.get(targetName);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!source && !target && sourceName === targetName) return quantity;
  if (!source || !target || source.dimension !== target.dimension) return null;
  const converted = Number(((quantity * source.factorToBase) / target.factorToBase).toFixed(6));
  return converted > 0 ? converted : null;
};

export const defaultSizeFactor = (factor, index = 0) =>
  Number.isFinite(Number(factor)) && Number(factor) > 0
    ? Number(factor)
    : index === 0
      ? 1.0
      : Number((1.0 + index * 0.25).toFixed(2));

export const scaleIngredientAmount = (baseQty, factor, unit) => {
  const numQty = Number(baseQty);
  if (!Number.isFinite(numQty) || numQty <= 0) return "";
  const unitDef = unitFactors.get(safeLower(unit));
  if (
    unitDef?.dimension === "count" ||
    ["pcs", "pc", "piece", "pieces", "ea", "each", "unit", "units", "cup", "cups"].includes(safeLower(unit))
  ) {
    return String(numQty);
  }
  const scaled = Number((numQty * factor).toFixed(2));
  return String(scaled);
};

export function buildSafeSizeQtyMap(entriesOrSource = null) {
  const map = Object.create(null);
  if (!entriesOrSource) return map;

  const setKey = (rawKey, val) => {
    if (typeof rawKey !== "string" || !rawKey.length) return;
    Object.defineProperty(map, rawKey, {
      value: val,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  };

  if (Array.isArray(entriesOrSource)) {
    for (const pair of entriesOrSource) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      setKey(pair[0], pair[1]);
    }
    return map;
  }

  if (entriesOrSource instanceof Map) {
    for (const [k, v] of entriesOrSource.entries()) {
      setKey(k, v);
    }
    return map;
  }

  if (typeof entriesOrSource === "object") {
    for (const key of Object.keys(entriesOrSource)) {
      if (Object.hasOwn(entriesOrSource, key)) {
        setKey(key, entriesOrSource[key]);
      }
    }
  }

  return map;
}

export function readSizeQtyValue(map, label) {
  if (!map || typeof map !== "object") return undefined;
  if (typeof label !== "string" || !label.length) return undefined;
  return Object.hasOwn(map, label) ? map[label] : undefined;
}

export function writeSizeQtyValue(map, label, value) {
  const next = buildSafeSizeQtyMap(map);
  if (typeof label === "string" && label.length) {
    Object.defineProperty(next, label, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return next;
}

export function computeMenuItemCostSummary({
  sellingPrice,
  directCostPrice = 0,
  sizeLabel = "",
  sizeFactor = 1.0,
  ingredients = [],
  inventory = [],
  targetFoodCost = DEFAULT_TARGET_FOOD_COST,
} = {}) {
  const rawPrice = Number(sellingPrice || 0);
  const numericPrice = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 0;
  const rawDirectCost = Number(directCostPrice || 0);
  const activeDirectCost = Number.isFinite(rawDirectCost) && rawDirectCost > 0 ? rawDirectCost : 0;
  const effectiveTarget = normalizeTargetFoodCost(targetFoodCost);
  const factor = defaultSizeFactor(sizeFactor, 0);
  const cleanIngredients = Array.isArray(ingredients) ? ingredients.filter(Boolean) : [];
  const cleanSizeLabel = typeof sizeLabel === "string" ? sizeLabel : "";

  let rawCost = 0;
  let usedCount = 0;
  let allUsedComplete = true;
  let costSource = "none";

  if (cleanIngredients.length > 0) {
    for (const ing of cleanIngredients) {
      const rawSizeQty = cleanSizeLabel ? readSizeQtyValue(ing.quantityBySize, cleanSizeLabel) : undefined;
      if (rawSizeQty !== undefined && !(Number(rawSizeQty) > 0)) {
        continue;
      }
      const recipeUnit = ing.unit || ing.stockUnit || "pcs";
      const qtyUsed = Number(
        cleanSizeLabel
          ? (rawSizeQty ?? scaleIngredientAmount(ing.quantityUsed, factor, recipeUnit))
          : ing.quantityUsed,
      );
      if (!(qtyUsed > 0)) {
        continue;
      }
      usedCount += 1;
      const invItem = findInventoryItemInList(inventory, ing.name || ing.item, ing.inventoryItemId);
      const unitCost = Number(invItem?.unitCost ?? invItem?.unit_cost ?? ing.unitCost ?? 0);
      const stockUnit = invItem?.unit || ing.stockUnit || ing.unit || "pcs";
      const stockQty = convertRecipeAmount(qtyUsed, recipeUnit, stockUnit);
      if (!stockQty || !(Number.isFinite(unitCost) && unitCost > 0)) {
        allUsedComplete = false;
      } else {
        rawCost += Number((stockQty * unitCost).toFixed(4));
      }
    }
    if (usedCount > 0) {
      costSource = "recipe";
    }
  } else if (activeDirectCost > 0) {
    rawCost = Number(activeDirectCost.toFixed(4));
    costSource = "direct";
  }

  const safeRawCost = Number.isFinite(rawCost) ? rawCost : 0;
  const cost = Number(safeRawCost.toFixed(2));
  const costComplete =
    costSource === "recipe"
      ? usedCount > 0 && allUsedComplete
      : costSource === "direct";

  const grossProfit = numericPrice > 0 ? Number((numericPrice - cost).toFixed(2)) : null;
  const margin =
    numericPrice > 0 && Number.isFinite(cost)
      ? Number((((numericPrice - cost) / numericPrice) * 100).toFixed(1))
      : null;
  const foodCostPercent =
    numericPrice > 0 && Number.isFinite(cost)
      ? Number(((cost / numericPrice) * 100).toFixed(1))
      : null;
  const suggestedPrice =
    safeRawCost > 0
      ? Math.ceil(((safeRawCost / effectiveTarget) - 1e-9) / 5) * 5
      : null;

  return {
    cost: Number.isFinite(cost) ? cost : 0,
    costComplete,
    usedCount,
    costSource,
    grossProfit: grossProfit !== null && Number.isFinite(grossProfit) ? grossProfit : null,
    margin: margin !== null && Number.isFinite(margin) ? margin : null,
    foodCostPercent: foodCostPercent !== null && Number.isFinite(foodCostPercent) ? foodCostPercent : null,
    suggestedPrice,
  };
}
