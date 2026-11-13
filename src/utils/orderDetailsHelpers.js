export const VOID_REASON_PRESETS = [
  "Customer changed mind before preparation",
  "Duplicate / accidental entry",
  "Out of stock ingredient",
  "Wrong order entered",
  "Preparation quality issue",
];

export const ITEM_REVERT_REASON_PRESETS = [
  "Wrong product ordered",
  "Customer ordered something else",
  "Wrong quantity punched",
  "Duplicate / accidental entry",
];

export function getDefaultVoidStockAction(status, defaultAction = "restore") {
  if (String(status || "") === "Pending") return "restore";
  return defaultAction === "spoilage" ? "spoilage" : "restore";
}

export function formatAuditTimestamp(iso) {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatConsumptionQuantity(value, unit = "") {
  const num = Number(value || 0);
  const clean = Number.isFinite(num)
    ? Number(num.toFixed(4)).toString()
    : "0";
  return unit ? `${clean} ${unit}` : clean;
}
