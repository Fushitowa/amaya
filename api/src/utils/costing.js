import { toInventoryQuantity } from "./inventoryUnits.js";

export const DEFAULT_TARGET_FOOD_COST = 0.30;
export const MIN_TARGET_FOOD_COST = 0.10;
export const MAX_TARGET_FOOD_COST = 0.90;

/**
 * Normalize target food cost ratio to [0.10, 0.90], rejecting non-scalar coercions.
 */
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

/**
 * Compute the ingredient cost for a single recipe or add-on line.
 */
export function calculateLineCost(quantityUsed, recipeUnit, stockUnit, unitCost) {
  const stockQty = toInventoryQuantity(quantityUsed, recipeUnit, stockUnit);
  if (!stockQty) return { stockQty: null, cost: 0, complete: false };
  const uc = Number(unitCost || 0);
  const complete = Number.isFinite(uc) && uc > 0;
  const cost = complete ? Number((stockQty * uc).toFixed(4)) : 0;
  return { stockQty, cost, complete };
}

/**
 * Summarize recipe cost, gross profit, margin %, food cost %, and suggested selling price
 * (rounded up to the nearest ₱5 based on target food cost ratio, default 30%).
 */
export function summarizeCosting(sellingPrice, parts, targetFoodCost = DEFAULT_TARGET_FOOD_COST) {
  const numericPrice = Number(sellingPrice || 0);
  const target = normalizeTargetFoodCost(targetFoodCost);

  const rawCost = parts.reduce((sum, part) => sum + Number(part.cost || 0), 0);
  const cost = Number(rawCost.toFixed(2));
  const costComplete = parts.length > 0 && parts.every((part) => Boolean(part.complete));
  const grossProfit = numericPrice > 0 ? Number((numericPrice - cost).toFixed(2)) : null;
  const margin = numericPrice > 0 ? Number((((numericPrice - cost) / numericPrice) * 100).toFixed(1)) : null;
  const foodCostPercent = numericPrice > 0 ? Number(((cost / numericPrice) * 100).toFixed(1)) : null;
  const suggestedPrice = rawCost > 0 ? Math.ceil(((rawCost / target) - 1e-9) / 5) * 5 : null;

  return {
    cost,
    costComplete,
    grossProfit,
    margin,
    foodCostPercent,
    suggestedPrice,
  };
}
