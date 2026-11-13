export function getStockHealth(
  quantity,
  maximumStock,
  { overMaximum = false, lowThreshold = 40, criticalThreshold = 20 } = {},
) {
  const current = Number(quantity || 0);
  const maximum = maximumStock == null || maximumStock === "" ? null : Number(maximumStock);
  const capacityPercent = maximum != null && Number.isFinite(maximum) && maximum > 0
    ? Math.min(100, Math.max(0, (current / maximum) * 100))
    : null;
  const reportedPercent = capacityPercent == null ? null : Math.round(capacityPercent);
  const lowPct = Number.isFinite(Number(lowThreshold)) ? Number(lowThreshold) : 40;
  const criticalPct = Math.min(lowPct - 1, Number.isFinite(Number(criticalThreshold)) ? Number(criticalThreshold) : 20);
  const tone = overMaximum
    ? "over"
    : reportedPercent == null
      ? "untracked"
      : reportedPercent <= criticalPct
        ? "critical"
        : reportedPercent <= lowPct
          ? "low"
          : reportedPercent <= 70
            ? "moderate"
            : "available";

  return { capacityPercent, reportedPercent, tone };
}
