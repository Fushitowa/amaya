import { toInventoryQuantity } from "./inventoryUnits.js";

export const DEFAULT_TARGET_FOOD_COST = 0.30;

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
  const target = Number.isFinite(Number(targetFoodCost)) && Number(targetFoodCost) > 0 && Number(targetFoodCost) < 1
    ? Number(targetFoodCost)
    : DEFAULT_TARGET_FOOD_COST;

  const rawCost = parts.reduce((sum, part) => sum + Number(part.cost || 0), 0);
  const cost = Number(rawCost.toFixed(2));
  const costComplete = parts.length > 0 && parts.every((part) => Boolean(part.complete));
  const grossProfit = numericPrice > 0 ? Number((numericPrice - cost).toFixed(2)) : null;
  const margin = numericPrice > 0 ? Number((((numericPrice - cost) / numericPrice) * 100).toFixed(1)) : null;
  const foodCostPercent = numericPrice > 0 ? Number(((cost / numericPrice) * 100).toFixed(1)) : null;
  const suggestedPrice = rawCost > 0 ? Math.ceil((rawCost / target) / 5) * 5 : null;

  return {
    cost,
    costComplete,
    grossProfit,
    margin,
    foodCostPercent,
    suggestedPrice,
  };
}
