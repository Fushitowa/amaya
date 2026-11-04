export function getStockHealth(quantity, maximumStock, { overMaximum = false } = {}) {
  const current = Number(quantity || 0);
  const maximum = maximumStock == null || maximumStock === "" ? null : Number(maximumStock);
  const capacityPercent = maximum != null && Number.isFinite(maximum) && maximum > 0
    ? Math.min(100, Math.max(0, (current / maximum) * 100))
    : null;
  const reportedPercent = capacityPercent == null ? null : Math.round(capacityPercent);
  const tone = overMaximum
    ? "over"
    : reportedPercent == null
      ? "untracked"
      : reportedPercent <= 20
        ? "critical"
        : reportedPercent <= 40
          ? "low"
          : reportedPercent <= 70
            ? "moderate"
            : "available";

  return { capacityPercent, reportedPercent, tone };
}
