export const UNIT_DEFINITIONS = new Map();

function register(dimension, factorToBase, aliases) {
  for (const alias of aliases) {
    UNIT_DEFINITIONS.set(alias, { dimension, factorToBase });
  }
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
register("count", 1, ["can", "cans"]);
register("count", 12, ["dozen", "doz"]);
register("count", 2, ["pair", "pairs"]);

export const UNIT_CANONICAL_MAP = Object.freeze(new Map([
  ["µg", "ug"],
  ["μg", "ug"],
  ["ug", "ug"],
  ["mcg", "ug"],
  ["microgram", "ug"],
  ["micrograms", "ug"],
  ["mg", "mg"],
  ["milligram", "mg"],
  ["milligrams", "mg"],
  ["g", "g"],
  ["gm", "g"],
  ["gms", "g"],
  ["gram", "g"],
  ["grams", "g"],
  ["hg", "hg"],
  ["hectogram", "hg"],
  ["hectograms", "hg"],
  ["kg", "kg"],
  ["kilo", "kg"],
  ["kilos", "kg"],
  ["kilogram", "kg"],
  ["kilograms", "kg"],
  ["t", "t"],
  ["tonne", "t"],
  ["tonnes", "t"],
  ["metric ton", "t"],
  ["metric tons", "t"],
  ["oz", "oz"],
  ["ounce", "oz"],
  ["ounces", "oz"],
  ["lb", "lb"],
  ["lbs", "lb"],
  ["pound", "lb"],
  ["pounds", "lb"],
  ["ml", "ml"],
  ["cc", "ml"],
  ["cm3", "ml"],
  ["cm³", "ml"],
  ["milliliter", "ml"],
  ["milliliters", "ml"],
  ["millilitre", "ml"],
  ["millilitres", "ml"],
  ["cl", "cl"],
  ["centiliter", "cl"],
  ["centiliters", "cl"],
  ["centilitre", "cl"],
  ["centilitres", "cl"],
  ["dl", "dl"],
  ["deciliter", "dl"],
  ["deciliters", "dl"],
  ["decilitre", "dl"],
  ["decilitres", "dl"],
  ["l", "l"],
  ["liter", "l"],
  ["liters", "l"],
  ["litre", "l"],
  ["litres", "l"],
  ["m3", "m3"],
  ["m³", "m3"],
  ["cubic meter", "m3"],
  ["cubic meters", "m3"],
  ["cubic metre", "m3"],
  ["cubic metres", "m3"],
  ["tsp", "tsp"],
  ["teaspoon", "tsp"],
  ["teaspoons", "tsp"],
  ["tbsp", "tbsp"],
  ["tablespoon", "tbsp"],
  ["tablespoons", "tbsp"],
  ["fl oz", "fl oz"],
  ["fluid ounce", "fl oz"],
  ["fluid ounces", "fl oz"],
  ["cup", "cup"],
  ["cups", "cup"],
  ["pt", "pt"],
  ["pint", "pt"],
  ["pints", "pt"],
  ["qt", "qt"],
  ["quart", "qt"],
  ["quarts", "qt"],
  ["gal", "gal"],
  ["gallon", "gal"],
  ["gallons", "gal"],
  ["pc", "pc"],
  ["pcs", "pc"],
  ["piece", "pc"],
  ["pieces", "pc"],
  ["ea", "pc"],
  ["each", "pc"],
  ["unit", "pc"],
  ["units", "pc"],
  ["pair", "pair"],
  ["pairs", "pair"],
  ["doz", "dozen"],
  ["dozen", "dozen"],
  ["dozens", "dozen"],
  ["bottle", "bottle"],
  ["bottles", "bottle"],
  ["pack", "pack"],
  ["packs", "pack"],
  ["box", "box"],
  ["boxes", "box"],
  ["can", "can"],
  ["cans", "can"],
  ["bag", "bag"],
  ["bags", "bag"],
  ["roll", "roll"],
  ["rolls", "roll"],
  ["sack", "sack"],
  ["sacks", "sack"],
  ["set", "set"],
  ["sets", "set"],
  ["tub", "tub"],
  ["tubs", "tub"],
  ["jar", "jar"],
  ["jars", "jar"],
  ["carton", "carton"],
  ["cartons", "carton"],
]));

export const DISCRETE_CONTAINER_UNITS = Object.freeze(new Set([
  "pc",
  "pair",
  "dozen",
  "bottle",
  "pack",
  "box",
  "can",
  "bag",
  "roll",
  "sack",
  "set",
  "tub",
  "jar",
  "carton",
]));

export function round2(value) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num === 0) return 0.0;
  const rounded = Number((Math.sign(num) * (Math.abs(num) + Number.EPSILON)).toFixed(2));
  return rounded === 0 ? 0.0 : rounded;
}

export function round6(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

export function cleanUnit(unit) {
  return String(unit || "").trim().toLowerCase();
}

export function normalizeUnit(unit) {
  const cleaned = cleanUnit(unit).replace(/\s+/g, " ");
  if (!cleaned) return "";
  return UNIT_CANONICAL_MAP.get(cleaned) || cleaned;
}

export function getUnitDimension(unit) {
  const norm = normalizeUnit(unit);
  if (!norm) return null;
  if (DISCRETE_CONTAINER_UNITS.has(norm)) return "count";
  return UNIT_DEFINITIONS.get(cleanUnit(unit))?.dimension
    || UNIT_DEFINITIONS.get(norm)?.dimension
    || null;
}

export function isDiscreteCountUnit(unit) {
  const norm = normalizeUnit(unit);
  return getUnitDimension(norm) === "count" && DISCRETE_CONTAINER_UNITS.has(norm);
}

/**
 * Convert a recipe or usage amount into the inventory item's stock unit.
 * Preserves 6-decimal rounding for standard amounts while retaining 12-decimal precision
 * for sub-micro quantities (e.g. 0.0004 g -> kg = 4e-7) instead of collapsing to null.
 */
export function toInventoryQuantity(quantity, recipeUnit, stockUnit) {
  const amount = Number(quantity);
  const sourceName = cleanUnit(recipeUnit);
  const targetName = cleanUnit(stockUnit);
  if (!Number.isFinite(amount) || amount <= 0 || !sourceName || !targetName) return null;

  const sourceNorm = normalizeUnit(sourceName);
  const targetNorm = normalizeUnit(targetName);
  const source = UNIT_DEFINITIONS.get(sourceName) || UNIT_DEFINITIONS.get(sourceNorm);
  const target = UNIT_DEFINITIONS.get(targetName) || UNIT_DEFINITIONS.get(targetNorm);

  let converted;
  if (!source && !target && sourceNorm === targetNorm) {
    converted = amount;
  } else if (source && target && source.dimension === target.dimension) {
    converted = (amount * source.factorToBase) / target.factorToBase;
  } else {
    return null;
  }

  const rounded = Number(converted.toFixed(6));
  if (rounded > 0) return rounded;
  const fineRounded = Number(converted.toFixed(12));
  return fineRounded > 0 ? fineRounded : null;
}

/**
 * Things you count one by one can never be split: 10.21 pieces does not exist.
 * (Dozen is left out on purpose: half a dozen is a real amount.)
 */
export function isWholeNumberUnit(unit) {
  const norm = normalizeUnit(unit);
  return norm === "pc" || norm === "can" || norm === "pair";
}
