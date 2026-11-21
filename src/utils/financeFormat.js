// Small formatting helpers shared by the Finance page and its exports.

export function peso(val) {
  const num = Number(val || 0);
  const safe = Number.isFinite(num) ? num : 0;
  return `₱${safe.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Hidden figures arrive as null while the Net Income PIN is locked (profitLocked).
export const LOCKED_TEXT = "₱••••••";
export function lockedPeso(val) {
  return val == null ? LOCKED_TEXT : peso(val);
}

export function round2(val) {
  const num = Number(val || 0);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
}

// The server still posts a payment from an account that looks short, but says so in `warnings`.
export function withWarnings(message, result) {
  const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];
  return warnings.length ? `${message} Heads up: ${warnings.join(" ")}` : message;
}

// Today in Manila as YYYY-MM-DD (used as the latest date a user may pick).
export function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Cash drawer over/short: positive is over, negative is short. Words as well as colour.
export function describeVariance(value) {
  if (value == null) return "—";
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return peso(0);
  return `${num < 0 ? "-" : "+"}${peso(Math.abs(num))} ${num < 0 ? "short" : "over"}`;
}

