export function formatUnitCost(cost) {
  const num = Number(cost || 0);
  if (!Number.isFinite(num) || num <= 0) return "0.00";
  const fixed3 = num.toFixed(3);
  return fixed3.endsWith("0") ? num.toFixed(2) : fixed3;
}
