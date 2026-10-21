/**
 * Stock availability & boundary evaluation logic.
 * Computes required ingredients, remaining available stock, exhaustion, and shortages.
 */
export function evaluateStockBoundary({ inventoryQuantity = 0, perServing = 0, orderQuantity = 1 } = {}) {
  const inv = Number(inventoryQuantity || 0);
  const per = Number(perServing || 0);
  const qty = Number(orderQuantity || 1);

  const required = Number((per * qty).toFixed(6));
  const availableAfter = Number((inv - required).toFixed(6));
  const canFulfill = inv >= required && inv > 0 && required > 0;
  const isDepletedAfter = availableAfter <= 0;
  const hasShortage = availableAfter < 0 || inv <= 0;
  const shortageAmount = hasShortage ? Number(Math.max(0, required - inv).toFixed(6)) : 0;

  return {
    required,
    availableAfter,
    canFulfill,
    isDepletedAfter,
    hasShortage,
    shortageAmount,
  };
}
