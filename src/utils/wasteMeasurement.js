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

export const WASTE_REASON_MAP = Object.freeze(
  Object.fromEntries(WASTE_REASONS.map((r) => [r.value, r])),
);

export const MEASUREMENT_METHODS = Object.freeze([
  {
    value: "remaining_count",
    label: "Measure What's Left",
    shortLabel: "Remaining",
    description: "Weigh or count what's left; the POS computes the loss.",
  },
  {
    value: "direct_measure",
    label: "Measure Exact Waste",
    shortLabel: "Direct waste",
    description: "Enter the exact measured quantity spoiled or spilled.",
  },
]);

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

const UNIT_DIMENSIONS = new Map([
  ["ug", { dim: "mass", factor: 0.000001 }],
  ["mg", { dim: "mass", factor: 0.001 }],
  ["g", { dim: "mass", factor: 1 }],
  ["hg", { dim: "mass", factor: 100 }],
  ["kg", { dim: "mass", factor: 1000 }],
  ["t", { dim: "mass", factor: 1000000 }],
  ["oz", { dim: "mass", factor: 28.349523125 }],
  ["lb", { dim: "mass", factor: 453.59237 }],
  ["ml", { dim: "volume", factor: 1 }],
  ["cl", { dim: "volume", factor: 10 }],
  ["dl", { dim: "volume", factor: 100 }],
  ["l", { dim: "volume", factor: 1000 }],
  ["m3", { dim: "volume", factor: 1000000 }],
  ["tsp", { dim: "volume", factor: 4.92892159375 }],
  ["tbsp", { dim: "volume", factor: 14.78676478125 }],
  ["fl oz", { dim: "volume", factor: 29.5735295625 }],
  ["cup", { dim: "volume", factor: 236.5882365 }],
  ["pt", { dim: "volume", factor: 473.176473 }],
  ["qt", { dim: "volume", factor: 946.352946 }],
  ["gal", { dim: "volume", factor: 3785.411784 }],
  ["pc", { dim: "count", factor: 1 }],
  ["pair", { dim: "count", factor: 2 }],
  ["dozen", { dim: "count", factor: 12 }],
  ["bottle", { dim: "count", factor: 1 }],
  ["pack", { dim: "count", factor: 1 }],
  ["box", { dim: "count", factor: 1 }],
  ["can", { dim: "count", factor: 1 }],
  ["bag", { dim: "count", factor: 1 }],
  ["roll", { dim: "count", factor: 1 }],
  ["sack", { dim: "count", factor: 1 }],
  ["set", { dim: "count", factor: 1 }],
  ["tub", { dim: "count", factor: 1 }],
  ["jar", { dim: "count", factor: 1 }],
  ["carton", { dim: "count", factor: 1 }],
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
  return UNIT_DIMENSIONS.get(norm)?.dim || null;
}

export function isDiscreteCountUnit(unit) {
  const norm = normalizeWasteUnit(unit);
  return getWasteUnitDimension(norm) === "count" && DISCRETE_CONTAINER_UNITS.has(norm);
}

export function getDefaultMeasurementMethod(item) {
  const dim = getWasteUnitDimension(item?.unit);
  if (dim === "mass" || dim === "volume") {
    return "remaining_count";
  }
  return "direct_measure";
}

export function getMeasurementMethodLabel(value, item) {
  const isCount = getWasteUnitDimension(item?.unit) === "count";
  if (value === "remaining_count") {
    return isCount ? "Count What's Left" : "Measure What's Left";
  }
  if (value === "direct_measure") {
    return isCount ? "Count Exact Waste" : "Measure Exact Waste";
  }
  return value;
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

export function convertWasteInputToStockUnit(amount, inputUnit, item) {
  const stockUnitRaw = String(item?.unit || "").trim();
  const normalizedStock = normalizeWasteUnit(stockUnitRaw);
  const normalizedInput = normalizeWasteUnit(inputUnit || stockUnitRaw);

  if (!normalizedStock || !normalizedInput) {
    return { ok: false, error: "Inventory unit and measured unit are both required." };
  }

  if (normalizedInput === normalizedStock) {
    return { ok: true, quantityInStockUnit: round6(amount), usedPackageConversion: false };
  }

  const contentsPerPackage = Number(item?.contentsPerPackage ?? item?.contents_per_package ?? 0);
  const packageUnitRaw = String(item?.packageUnit ?? item?.package_unit ?? "").trim();
  const normalizedPackage = normalizeWasteUnit(packageUnitRaw);

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
    };
  }

  const stockInfo = UNIT_DIMENSIONS.get(normalizedStock);
  const inputInfo = UNIT_DIMENSIONS.get(normalizedInput);

  if (!stockInfo || !inputInfo || stockInfo.dim !== inputInfo.dim) {
    return {
      ok: false,
      error: `Unit "${inputUnit}" is not compatible with stock unit "${stockUnitRaw}".`,
    };
  }

  if (
    stockInfo.dim === "count" &&
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
    };
  }

  const converted = round6((amount * inputInfo.factor) / stockInfo.factor);
  if (converted <= 0) {
    return { ok: false, error: "Converted waste quantity is below 0.000001 precision." };
  }
  return {
    ok: true,
    quantityInStockUnit: converted,
    usedPackageConversion: false,
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
    return { ok: false, error: "Select an inventory item first." };
  }

  if (measurementMethod !== "remaining_count" && measurementMethod !== "direct_measure") {
    return {
      ok: false,
      error: "Choose either Measure What's Left or Measure Exact Waste.",
    };
  }

  if (!WASTE_REASON_MAP[wasteReason]) {
    return {
      ok: false,
      error: "Choose a waste reason.",
    };
  }

  const cleanNote = typeof note === "string" ? note.trim() : "";
  if (cleanNote.length < 5) {
    return {
      ok: false,
      error: "Add a short explanation note (at least 5 characters).",
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
      error: "Enter a valid number (for example: 150 or 2).",
    };
  }
  if (parsedMeasured > MAX_WASTE_INPUT_QTY) {
    return {
      ok: false,
      error: `Quantity cannot exceed ${MAX_WASTE_INPUT_QTY.toLocaleString()}.`,
    };
  }
  const roundedMeasured = round6(parsedMeasured);
  if (parsedMeasured > 0 && roundedMeasured <= 0) {
    return {
      ok: false,
      error: "Quantity is smaller than the minimum 0.000001 precision.",
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
      error: "This item has zero stock on hand.",
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
        error: "Container tare weight must be 0 or greater.",
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
        error: "Tare weight only applies when measuring what's left.",
      };
    }
  }

  const requiresWholeStockCount = isDiscreteCountUnit(item.unit);

  if (measurementMethod === "remaining_count") {
    if (roundedMeasured < 0) {
      return { ok: false, error: "Remaining quantity cannot be negative." };
    }
    if (roundedTare > roundedMeasured) {
      return { ok: false, error: "Tare weight cannot exceed the total weighed amount." };
    }
    const netInput = round6(roundedMeasured - roundedTare);
    const converted = convertWasteInputToStockUnit(netInput, resolvedUnitRaw, item);
    if (!converted.ok) return converted;

    const netRemainingStock = converted.quantityInStockUnit;
    if (requiresWholeStockCount && !isWholeInteger(netRemainingStock)) {
      return {
        ok: false,
        error: `Count items (${item.unit}) require whole numbers (no decimal pieces).`,
      };
    }
    if (netRemainingStock > currentStock + 1e-6) {
      return {
        ok: false,
        error: `Remaining (${netRemainingStock} ${item.unit}) cannot exceed stock on hand (${currentStock} ${item.unit}). Use Restock instead.`,
      };
    }
    const deductedQuantity = round6(currentStock - netRemainingStock);
    if (deductedQuantity <= 0) {
      return {
        ok: false,
        error: "Remaining equals stock on hand; enter a smaller remaining count.",
      };
    }
    return {
      ok: true,
      measurementMethod,
      wasteReason,
      note: cleanNote,
      measuredInputQty: roundedMeasured,
      measuredInputUnit: resolvedUnitRaw,
      tareWeight: hasTare ? roundedTare : null,
      beforeQuantity: currentStock,
      afterQuantity: round6(Math.max(0, netRemainingStock)),
      deductedQuantity,
      unit: item.unit,
    };
  }

  if (roundedMeasured <= 0) {
    return { ok: false, error: "Wasted quantity must be greater than zero." };
  }

  const converted = convertWasteInputToStockUnit(roundedMeasured, resolvedUnitRaw, item);
  if (!converted.ok) return converted;

  const deductedQuantity = converted.quantityInStockUnit;
  if (requiresWholeStockCount && !isWholeInteger(deductedQuantity)) {
    return {
      ok: false,
      error: `Count items (${item.unit}) require whole numbers (no decimal pieces).`,
    };
  }
  if (deductedQuantity > currentStock + 1e-6) {
    return {
      ok: false,
      error: `Wasted (${deductedQuantity} ${item.unit}) cannot exceed stock on hand (${currentStock} ${item.unit}).`,
    };
  }

  return {
    ok: true,
    measurementMethod,
    wasteReason,
    note: cleanNote,
    measuredInputQty: roundedMeasured,
    measuredInputUnit: resolvedUnitRaw,
    tareWeight: null,
    beforeQuantity: currentStock,
    afterQuantity: round6(Math.max(0, currentStock - deductedQuantity)),
    deductedQuantity,
    unit: item.unit,
  };
}

export function formatWasteQty(value, unit = "") {
  const num = Number(value);
  if (!Number.isFinite(num)) return unit ? `0 ${unit}` : "0";
  const rounded = round6(num);
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : String(Number(rounded.toFixed(3)));
  return unit ? `${formatted} ${unit}` : formatted;
}

export function getWasteReasonMeta(slug) {
  return (
    WASTE_REASON_MAP[slug] || {
      value: slug || "other",
      label: slug ? String(slug).replace(/_/g, " ") : "Spoilage",
      shortLabel: slug ? String(slug).replace(/_/g, " ") : "Spoilage",
    }
  );
}
