/**
 * Cash drawer over/short limits, in pesos per shift. Shared by the API (history and pattern checks)
 * and the Finance page (labels), so both grade a shift the same way.
 * They only flag shifts for review; nothing here is ever deducted from anyone's pay.
 */
export const DRAWER_DEFAULTS = Object.freeze({ ok: 50, review: 200 });
export const DRAWER_LIMIT_MAX = 100000;

function toPesos(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean" || typeof value === "object") return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
}

/** Clean limits from stored values, falling back to the defaults when missing or out of order. */
export function normalizeDrawerThresholds(ok, review) {
  const cleanOk = toPesos(ok);
  const cleanReview = toPesos(review);
  const valid = cleanOk !== null && cleanReview !== null
    && cleanOk >= 0 && cleanReview >= cleanOk && cleanReview <= DRAWER_LIMIT_MAX;
  return valid ? { ok: cleanOk, review: cleanReview } : { ...DRAWER_DEFAULTS };
}

/** Strict version for user input: returns the limits or an error message. */
export function validateDrawerThresholds(ok, review) {
  const cleanOk = toPesos(ok);
  const cleanReview = toPesos(review);
  if (cleanOk === null || cleanReview === null) return { error: "Both limits must be amounts in pesos." };
  if (cleanOk < 0) return { error: "The limits cannot be negative." };
  if (cleanReview < cleanOk) return { error: "The \"check today\" limit must be at least as big as the \"normal\" limit." };
  if (cleanReview > DRAWER_LIMIT_MAX) return { error: "That limit is too large." };
  return { ok: cleanOk, review: cleanReview };
}

/** How a shift's over/short amount reads: null when there is none yet. */
export function drawerVarianceStatus(value, thresholds = DRAWER_DEFAULTS) {
  if (value === null || value === undefined) return null;
  const size = Math.abs(Number(value));
  if (!Number.isFinite(size) || size <= thresholds.ok) return { key: "ok", label: "OK" };
  if (size <= thresholds.review) return { key: "review", label: "Take a look" };
  return { key: "investigate", label: "Check today" };
}

/** A cashier + weekday with at least 3 shifts, 2 or more of them outside the normal limit, is a pattern. */
export function isDrawerPattern(shifts, flaggedShifts) {
  return Number(shifts) >= 3 && Number(flaggedShifts) >= 2;
}
