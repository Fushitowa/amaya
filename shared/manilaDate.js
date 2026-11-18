export const MANILA_TIMEZONE = "Asia/Manila";

/**
 * Format a Date or timestamp as `YYYY-MM-DD` in Asia/Manila time.
 */
export function getManilaDateString(date = new Date()) {
  const target = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(target.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
}

export function getManilaTodayDateStr(date = new Date()) {
  return getManilaDateString(date);
}

/**
 * Validate calendar-accurate `YYYY-MM-DD` strings (rejects out-of-range days like `2026-02-30`).
 */
export function isValidIsoDateOnly(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function formatDbDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return getManilaDateString(value) || null;
  }
  return String(value).slice(0, 10);
}

export function formatManilaDate(
  value,
  options = { month: "short", day: "numeric", year: "numeric" },
  fallback = "—",
) {
  if (!value && value !== 0) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString("en-US", {
    timeZone: MANILA_TIMEZONE,
    ...options,
  });
}

export function formatManilaTime(
  value,
  options = { hour: "numeric", minute: "2-digit" },
  fallback = "—",
) {
  if (!value && value !== 0) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleTimeString("en-US", {
    timeZone: MANILA_TIMEZONE,
    ...options,
  });
}

export function formatManilaDateTime(
  value,
  options = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" },
  fallback = "—",
) {
  if (!value && value !== 0) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleString("en-US", {
    timeZone: MANILA_TIMEZONE,
    ...options,
  });
}
