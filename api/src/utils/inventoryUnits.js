const unitDefinitions = new Map();

function register(dimension, factorToBase, aliases) {
  for (const alias of aliases) unitDefinitions.set(alias, { dimension, factorToBase });
}

register("mass", 0.001, ["mg", "milligram", "milligrams"]);
register("mass", 1, ["g", "gram", "grams"]);
register("mass", 1000, ["kg", "kilogram", "kilograms"]);
register("mass", 28.349523125, ["oz", "ounce", "ounces"]);
register("mass", 453.59237, ["lb", "lbs", "pound", "pounds"]);
register("volume", 1, ["ml", "milliliter", "milliliters", "millilitre", "millilitres"]);
register("volume", 1000, ["l", "liter", "liters", "litre", "litres"]);
register("volume", 4.92892159375, ["tsp", "teaspoon", "teaspoons"]);
register("volume", 14.78676478125, ["tbsp", "tablespoon", "tablespoons"]);
register("volume", 236.5882365, ["cup", "cups"]);
register("volume", 29.5735295625, ["fl oz", "fluid ounce", "fluid ounces"]);
register("count", 1, ["pc", "pcs", "piece", "pieces", "ea", "each"]);
register("count", 12, ["dozen", "doz"]);

const cleanUnit = (unit) => String(unit || "").trim().toLocaleLowerCase();

/** Convert a recipe amount to the inventory item's stock unit at its 0.001 resolution. */
export function toInventoryQuantity(quantity, recipeUnit, stockUnit) {
  const amount = Number(quantity);
  const sourceName = cleanUnit(recipeUnit);
  const targetName = cleanUnit(stockUnit);
  if (!Number.isFinite(amount) || amount <= 0 || !sourceName || !targetName) return null;

  const source = unitDefinitions.get(sourceName);
  const target = unitDefinitions.get(targetName);
  let converted;
  if (!source && !target && sourceName === targetName) {
    converted = amount;
  } else if (source && target && source.dimension === target.dimension) {
    converted = amount * source.factorToBase / target.factorToBase;
  } else {
    return null;
  }

  const rounded = Number(converted.toFixed(3));
  return rounded > 0 ? rounded : null;
}

