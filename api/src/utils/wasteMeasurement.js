import { getUnitDimension, toInventoryQuantity } from "./inventoryUnits.js";

export const MAX_WASTE_INPUT_QTY = 9_999_999_999;

export const WASTE_REASONS = Object.freeze([
  {
    value: "spill_accident",
    label: "Spill / Dropped",
    shortLabel: "Spill",
    description: "Dropped bottle, spilled pitcher, or floor accident",
  },
  {
    value: "expired_spoiled",
    label: "Expired / Spoiled",
    shortLabel: "Expired",
    description: "Past shelf life, curdled, fermented, or spoiled",
  },
  {
    value: "prep_mistake",
    label: "Prep Mistake",
    shortLabel: "Prep mistake",
    description: "Wrong order build, burnt batch, or recipe mispour",
  },
  {
    value: "damaged_contaminated",
    label: "Damaged / Contaminated",
    shortLabel: "Damaged",
    description: "Torn seal, foreign object, or contaminated batch",
  },
  {
    value: "quality_reject",
    label: "Quality Reject",
    shortLabel: "Quality reject",
    description: "Failed taste, temperature, or freshness QC check",
  },
]);

export const WASTE_REASON_VALUES = Object.freeze(WASTE_REASONS.map((r) => r.value));
export const WASTE_REASON_MAP = Object.freeze(
  Object.fromEntries(WASTE_REASONS.map((r) => [r.value, r])),
);

export const MEASUREMENT_METHODS = Object.freeze([
  {
    value: "remaining_count",
    label: "Measure What's Left",
    shortLabel: "Remaining",
    description: "Weigh or count remaining usable stock; the POS computes the loss.",
  },
  {
    value: "direct_measure",
    label: "Measure Exact Waste",
    shortLabel: "Direct waste",
    description: "Enter the exact measured quantity spoiled or thrown out.",
  },
]);

export const MEASUREMENT_METHOD_VALUES = Object.freeze(
  MEASUREMENT_METHODS.map((m) => m.value),
);

const UNIT_CANONICAL_MAP = new Map([
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
  ["gram", "g"],
  ["grams", "g"],
  ["hg", "hg"],
  ["hectogram", "hg"],
  ["hectograms", "hg"],
  ["kg", "kg"],
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
  ["milliliter", "ml"],
  ["milliliters", "ml"],
  ["millilitre", "ml"],
  ["millilitres", "ml"],
  ["cc", "ml"],
  ["cm3", "ml"],
  ["cm³", "ml"],
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
  ["dozen", "dozen"],
  ["doz", "dozen"],
  ["pair", "pair"],
  ["pairs", "pair"],
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
]);

const DISCRETE_CONTAINER_UNITS = new Set([
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
]);

export function round6(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const scaled = num * 1e6;
  const adjusted = scaled + Math.sign(num) * Math.max(1e-9, Number.EPSILON * Math.abs(scaled));
  const rounded = Math.round(adjusted) / 1e6;
  return rounded === 0 ? 0 : rounded;
}

export function round2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const scaled = num * 100;
  const adjusted = scaled + Math.sign(num) * Math.max(1e-9, Number.EPSILON * Math.abs(scaled));
  const rounded = Math.round(adjusted) / 100;
  return rounded === 0 ? 0 : rounded;
}

export function normalizeWasteUnit(unit) {
  const key = String(unit || "").trim().toLowerCase();
  if (!key) return "";
  return UNIT_CANONICAL_MAP.get(key) || key;
}

export function getWasteUnitDimension(unit) {
  const norm = normalizeWasteUnit(unit);
  if (!norm) return null;
  if (DISCRETE_CONTAINER_UNITS.has(norm)) return "count";
  return getUnitDimension(norm) || getUnitDimension(unit);
}

export function parseStrictFiniteNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "object") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function isWholeInteger(num, tolerance = 1e-6) {
  return Math.abs(num - Math.round(num)) <= tolerance;
}

/**
 * Convert an input amount expressed in `inputUnit` into the item's canonical stock `unit`,
 * supporting sealed-pack definitions (`packageUnit` + `contentsPerPackage`) as well as
 * all metric/imperial/count conversions via `toInventoryQuantity`.
 */
export function convertWasteInputToStockUnit(amount, inputUnit, item) {
  const stockUnitRaw = String(item?.unit || "").trim();
  const normalizedStock = normalizeWasteUnit(stockUnitRaw);
  const normalizedInput = normalizeWasteUnit(inputUnit || stockUnitRaw);

  if (!normalizedStock || !normalizedInput) {
    return { ok: false, error: "Inventory unit and measured unit are both required." };
  }

  const contentsPerPackage = Number(item?.contentsPerPackage ?? item?.contents_per_package ?? 0);
  const packageUnitRaw = String(item?.packageUnit ?? item?.package_unit ?? "").trim();
  const normalizedPackage = normalizeWasteUnit(packageUnitRaw);

  if (normalizedInput === normalizedStock) {
    return {
      ok: true,
      quantityInStockUnit: round6(amount),
      usedPackageConversion: false,
      normalizedInput,
      normalizedStock,
    };
  }

  if (
    normalizedPackage &&
    Number.isFinite(contentsPerPackage) &&
    contentsPerPackage > 1 &&
    normalizedInput === normalizedPackage
  ) {
    const scaled = round6(amount * contentsPerPackage);
    if (scaled <= 0 && amount > 0) {
      return { ok: false, error: "Converted waste quantity is below 0.000001 precision." };
    }
    return {
      ok: true,
      quantityInStockUnit: scaled,
      usedPackageConversion: true,
      normalizedInput,
      normalizedStock,
    };
  }

  const stockDim = getWasteUnitDimension(stockUnitRaw);
  const inputDim = getWasteUnitDimension(inputUnit || stockUnitRaw);

  if (!stockDim || !inputDim || stockDim !== inputDim) {
    return {
      ok: false,
      error: `Unit "${inputUnit}" is not compatible with stock unit "${stockUnitRaw}".`,
    };
  }

  // Guard unconfigured discrete containers unless converting standard count multipliers into pc
  if (
    stockDim === "count" &&
    normalizedInput !== normalizedStock &&
    !(normalizedStock === "pc" && (normalizedInput === "dozen" || normalizedInput === "pair"))
  ) {
    return {
      ok: false,
      error: `Unit "${inputUnit}" cannot be converted cleanly into "${stockUnitRaw}".`,
    };
  }

  if (amount === 0) {
    return {
      ok: true,
      quantityInStockUnit: 0,
      usedPackageConversion: false,
      normalizedInput,
      normalizedStock,
    };
  }

  const converted = toInventoryQuantity(amount, normalizedInput, stockUnitRaw);
  if (converted === null || !Number.isFinite(converted)) {
    return {
      ok: false,
      error: `Could not convert "${inputUnit}" into "${stockUnitRaw}".`,
    };
  }

  const roundedConverted = round6(converted);
  if (amount > 0 && roundedConverted <= 0) {
    return { ok: false, error: "Converted waste quantity is below 0.000001 precision." };
  }

  return {
    ok: true,
    quantityInStockUnit: roundedConverted,
    usedPackageConversion: false,
    normalizedInput,
    normalizedStock,
  };
}

export function getCompatibleWasteUnits(item) {
  const stockUnitRaw = String(item?.unit || "").trim();
  const normalizedStock = normalizeWasteUnit(stockUnitRaw);
  const stockDim = getWasteUnitDimension(stockUnitRaw);
  const options = [];
  const seen = new Set();

  const pushUnit = (value, label) => {
    const norm = normalizeWasteUnit(value);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    options.push({ value, label: label || value });
  };

  if (stockDim === "mass") {
    if (stockUnitRaw) pushUnit(stockUnitRaw, stockUnitRaw);
    pushUnit("g", "g");
    pushUnit("kg", "kg");
  } else if (stockDim === "volume") {
    if (stockUnitRaw) pushUnit(stockUnitRaw, normalizedStock === "l" ? "L" : stockUnitRaw);
    pushUnit("ml", "ml");
    pushUnit("l", "L");
  } else if (stockUnitRaw) {
    pushUnit(stockUnitRaw, stockUnitRaw);
    if (normalizedStock === "pc") {
      pushUnit("dozen", "dozen (12 pcs)");
      pushUnit("pair", "pair (2 pcs)");
    }
  }

  const packageUnitRaw = String(item?.packageUnit ?? item?.package_unit ?? "").trim();
  const contentsPerPackage = Number(item?.contentsPerPackage ?? item?.contents_per_package ?? 0);
  if (packageUnitRaw && Number.isFinite(contentsPerPackage) && contentsPerPackage > 1) {
    pushUnit(packageUnitRaw, `${packageUnitRaw} (${contentsPerPackage} ${stockUnitRaw})`);
  }

  return options;
}

/**
 * Pure validator & exact arithmetic engine for Zero-Guesswork waste logging.
 */
export function computeWasteDeduction({
  item,
  measurementMethod,
  measuredQuantity,
  measuredUnit,
  tareWeight = null,
  wasteReason,
  note,
  beforeQuantity,
}) {
  if (!item || !item.unit) {
    return { ok: false, error: "Inventory item with a valid stock unit is required." };
  }

  if (!MEASUREMENT_METHOD_VALUES.includes(measurementMethod)) {
    return {
      ok: false,
      error: "Choose either 'Measure What's Left' (remaining_count) or 'Measure Exact Waste' (direct_measure).",
    };
  }

  if (!WASTE_REASON_VALUES.includes(wasteReason)) {
    return {
      ok: false,
      error: "Please select one of the standardized waste reasons.",
    };
  }

  const cleanNote = typeof note === "string" ? note.trim() : "";
  if (cleanNote.length < 5) {
    return {
      ok: false,
      error: "Please enter a brief explanation note (at least 5 characters).",
    };
  }
  if (cleanNote.length > 450) {
    return {
      ok: false,
      error: "Explanation note must be 450 characters or fewer.",
    };
  }

  const parsedMeasured = parseStrictFiniteNumber(measuredQuantity);
  if (parsedMeasured === null) {
    return {
      ok: false,
      error: "Measured quantity must be a valid finite number.",
    };
  }
  if (parsedMeasured > MAX_WASTE_INPUT_QTY) {
    return {
      ok: false,
      error: `Measured quantity cannot exceed ${MAX_WASTE_INPUT_QTY.toLocaleString()}.`,
    };
  }
  const roundedMeasured = round6(parsedMeasured);
  if (parsedMeasured > 0 && roundedMeasured <= 0) {
    return {
      ok: false,
      error: "Measured quantity is smaller than the minimum 0.000001 precision.",
    };
  }

  const resolvedUnitRaw = String(measuredUnit || item.unit || "").trim();
  if (!resolvedUnitRaw) {
    return { ok: false, error: "Measured unit is required." };
  }
  if (resolvedUnitRaw.length > 40) {
    return { ok: false, error: "Measured unit must be 40 characters or fewer." };
  }

  const currentStock = round6(
    beforeQuantity !== undefined && beforeQuantity !== null
      ? Number(beforeQuantity)
      : Number(item.quantity ?? 0),
  );

  if (!Number.isFinite(currentStock) || currentStock <= 0) {
    return {
      ok: false,
      error: "Cannot log waste on an item with zero stock on hand.",
    };
  }

  const hasTare =
    tareWeight !== null &&
    tareWeight !== undefined &&
    !(typeof tareWeight === "string" && tareWeight.trim() === "");

  let roundedTare = 0;
  if (hasTare) {
    const parsedTare = parseStrictFiniteNumber(tareWeight);
    if (parsedTare === null || parsedTare < 0) {
      return {
        ok: false,
        error: "Tare / container weight must be zero or a positive number.",
      };
    }
    if (parsedTare > MAX_WASTE_INPUT_QTY) {
      return {
        ok: false,
        error: `Tare weight cannot exceed ${MAX_WASTE_INPUT_QTY.toLocaleString()}.`,
      };
    }
    roundedTare = round6(parsedTare);
    if (parsedTare > 0 && roundedTare <= 0) {
      return {
        ok: false,
        error: "Tare weight is smaller than the minimum 0.000001 precision.",
      };
    }
    if (measurementMethod === "direct_measure" && roundedTare > 0) {
      return {
        ok: false,
        error: "Tare / container weight is only supported when measuring remaining stock.",
      };
    }
  }

  const normalizedStock = normalizeWasteUnit(item.unit);
  const stockDim = getWasteUnitDimension(item.unit);
  const requiresWholeStockCount =
    stockDim === "count" && DISCRETE_CONTAINER_UNITS.has(normalizedStock);

  if (measurementMethod === "remaining_count") {
    if (roundedMeasured < 0) {
      return { ok: false, error: "Remaining quantity cannot be negative." };
    }
    if (roundedTare > roundedMeasured) {
      return { ok: false, error: "Container tare weight cannot exceed the weighed total." };
    }

    const netRemainingInput = round6(roundedMeasured - roundedTare);
    const converted = convertWasteInputToStockUnit(netRemainingInput, resolvedUnitRaw, item);
    if (!converted.ok) {
      return converted;
    }

    const netRemainingStock = converted.quantityInStockUnit;
    if (requiresWholeStockCount && !isWholeInteger(netRemainingStock)) {
      return {
        ok: false,
        error: `Discrete count item (${item.name || item.unit}) requires whole integer remaining quantities in ${item.unit}.`,
      };
    }

    if (netRemainingStock > currentStock + 1e-6) {
      return {
        ok: false,
        error: `Remaining quantity (${netRemainingStock} ${item.unit}) exceeds current stock on hand (${currentStock} ${item.unit}). Use Restock or Inventory Adjustment instead.`,
      };
    }

    const deductedQuantity = round6(currentStock - netRemainingStock);
    if (deductedQuantity <= 0) {
      return {
        ok: false,
        error: "Remaining quantity equals current stock on hand; nothing to deduct as waste.",
      };
    }

    const afterQuantity = round6(Math.max(0, netRemainingStock));
    return {
      ok: true,
      measurementMethod,
      wasteReason,
      note: cleanNote,
      measuredInputQty: roundedMeasured,
      measuredInputUnit: resolvedUnitRaw,
      tareWeight: hasTare ? roundedTare : null,
      beforeQuantity: currentStock,
      afterQuantity,
      deductedQuantity,
      unit: item.unit,
    };
  }

  // measurementMethod === "direct_measure"
  if (roundedMeasured <= 0) {
    return { ok: false, error: "Wasted quantity must be greater than zero." };
  }

  const converted = convertWasteInputToStockUnit(roundedMeasured, resolvedUnitRaw, item);
  if (!converted.ok) {
    return converted;
  }

  const deductedQuantity = converted.quantityInStockUnit;
  if (requiresWholeStockCount && !isWholeInteger(deductedQuantity)) {
    return {
      ok: false,
      error: `Discrete count item (${item.name || item.unit}) requires whole integer quantities in ${item.unit}.`,
    };
  }

  if (deductedQuantity <= 0) {
    return {
      ok: false,
      error: "Converted waste quantity must be greater than zero.",
    };
  }

  if (deductedQuantity > currentStock + 1e-6) {
    return {
      ok: false,
      error: `Wasted quantity (${deductedQuantity} ${item.unit}) exceeds current stock on hand (${currentStock} ${item.unit}).`,
    };
  }

  const afterQuantity = round6(Math.max(0, currentStock - deductedQuantity));
  return {
    ok: true,
    measurementMethod,
    wasteReason,
    note: cleanNote,
    measuredInputQty: roundedMeasured,
    measuredInputUnit: resolvedUnitRaw,
    tareWeight: null,
    beforeQuantity: currentStock,
    afterQuantity,
    deductedQuantity,
    unit: item.unit,
  };
}
