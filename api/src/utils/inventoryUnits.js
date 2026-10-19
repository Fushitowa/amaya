const unitDefinitions = new Map();

function register(dimension, factorToBase, aliases) {
  for (const alias of aliases) unitDefinitions.set(alias, { dimension, factorToBase });
}

register("mass", 0.000001, ["µg", "μg", "ug", "mcg", "microgram", "micrograms"]);
register("mass", 0.001, ["mg", "milligram", "milligrams"]);
register("mass", 1, ["g", "gram", "grams"]);
register("mass", 100, ["hg", "hectogram", "hectograms"]);
register("mass", 1000, ["kg", "kilogram", "kilograms"]);
register("mass", 1000000, ["t", "tonne", "tonnes", "metric ton", "metric tons"]);
register("mass", 28.349523125, ["oz", "ounce", "ounces"]);
register("mass", 453.59237, ["lb", "lbs", "pound", "pounds"]);
register("volume", 1, ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc", "cm3", "cm³"]);
register("volume", 10, ["cl", "centiliter", "centiliters", "centilitre", "centilitres"]);
register("volume", 100, ["dl", "deciliter", "deciliters", "decilitre", "decilitres"]);
register("volume", 1000, ["l", "liter", "liters", "litre", "litres"]);
register("volume", 1000000, ["m3", "m³", "cubic meter", "cubic meters", "cubic metre", "cubic metres"]);
register("volume", 4.92892159375, ["tsp", "teaspoon", "teaspoons"]);
register("volume", 14.78676478125, ["tbsp", "tablespoon", "tablespoons"]);
register("volume", 236.5882365, ["cup", "cups"]);
register("volume", 29.5735295625, ["fl oz", "fluid ounce", "fluid ounces"]);
register("volume", 473.176473, ["pt", "pint", "pints"]);
register("volume", 946.352946, ["qt", "quart", "quarts"]);
register("volume", 3785.411784, ["gal", "gallon", "gallons"]);
register("count", 1, ["pc", "pcs", "piece", "pieces", "ea", "each", "unit", "units"]);
register("count", 12, ["dozen", "doz"]);
register("count", 2, ["pair", "pairs"]);

const cleanUnit = (unit) => String(unit || "").trim().toLocaleLowerCase();

/** Convert a recipe amount to the inventory item's stock unit at six-decimal precision. */
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

  const rounded = Number(converted.toFixed(6));
  return rounded > 0 ? rounded : null;
}

