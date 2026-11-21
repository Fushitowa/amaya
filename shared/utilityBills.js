/**
 * Utility bills by service period (payroll plan Phase 3B, O3.4 / O3.5). Pure: no database, no clock.
 *
 * Accrual rule: a utility cost belongs to the month the power, water or gas was used, not the
 * month the bill arrived. A bill whose service period spans months is split by days (the
 * Restaurant365 "dates of service" method). A month with no bill yet is estimated as
 * last bill ÷ its days × the month's uncovered days — shown, never posted (decision D7).
 */

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const round3 = (value) => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;

function parseDate(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86_400_000) + 1;
}

export function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  return {
    start: formatDate(new Date(Date.UTC(y, m - 1, 1))),
    end: formatDate(new Date(Date.UTC(y, m, 0))),
    days: new Date(Date.UTC(y, m, 0)).getUTCDate(),
  };
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

// Longest service period one bill may cover (a quarterly water bill fits).
export const MAX_SERVICE_DAYS = 93;

/**
 * Split a bill into one part per calendar month by days. Amounts are rounded per part and the last
 * part takes the rounding difference, so the parts always add up to the bill exactly. A meter
 * reading is shared the same way.
 *
 * @returns {Array<{month, partFrom, partTo, days, amount, readingShare}>}
 */
export function splitServicePeriod(serviceFrom, serviceTo, amount, reading = null) {
  if (!serviceFrom || !serviceTo || serviceFrom > serviceTo) {
    throw new Error("The service period must start on or before the day it ends.");
  }
  const totalDays = daysBetweenInclusive(serviceFrom, serviceTo);
  const total = round2(amount);
  const parts = [];
  let cursor = serviceFrom;
  while (cursor <= serviceTo) {
    const month = cursor.slice(0, 7);
    const { end } = monthBounds(month);
    const partTo = end < serviceTo ? end : serviceTo;
    parts.push({ month, partFrom: cursor, partTo, days: daysBetweenInclusive(cursor, partTo) });
    const next = parseDate(partTo);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = formatDate(next);
  }
  let allocated = 0;
  let allocatedReading = 0;
  const hasReading = reading !== null && reading !== undefined && Number.isFinite(Number(reading));
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    part.amount = last ? round2(total - allocated) : round2((total * part.days) / totalDays);
    allocated = round2(allocated + part.amount);
    if (hasReading) {
      part.readingShare = last
        ? round3(Number(reading) - allocatedReading)
        : round3((Number(reading) * part.days) / totalDays);
      allocatedReading = round3(allocatedReading + part.readingShare);
    } else {
      part.readingShare = null;
    }
  });
  return parts;
}

/**
 * Estimate for `month` when its bill is not in yet: the latest bill's daily cost × the month's
 * days not covered by any bill. `coveredDays` = days of `month` already covered by bill parts.
 * Returns null when there is nothing to estimate.
 */
export function estimateUncoveredMonth(lastBill, month, coveredDays = 0) {
  if (!lastBill) return null;
  const { days } = monthBounds(month);
  const uncoveredDays = Math.max(0, days - Number(coveredDays || 0));
  if (!uncoveredDays) return null;
  const billDays = daysBetweenInclusive(lastBill.serviceFrom, lastBill.serviceTo);
  if (!(billDays > 0)) return null;
  return {
    month,
    uncoveredDays,
    dailyCost: round2(Number(lastBill.amount) / billDays),
    estimatedAmount: round2((Number(lastBill.amount) / billDays) * uncoveredDays),
  };
}
