import { getPayrollRates } from "./payrollRates.js";

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Cut-offs and working days
// ---------------------------------------------------------------------------------------------

function parseDate(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Semi-monthly cut-off containing `date`: 1–15 or 16–end of month. */
export function cutoffFor(dateString) {
  const date = parseDate(dateString);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (date.getUTCDate() <= 15) {
    return { periodStart: formatDate(new Date(Date.UTC(y, m, 1))), periodEnd: formatDate(new Date(Date.UTC(y, m, 15))) };
  }
  return { periodStart: formatDate(new Date(Date.UTC(y, m, 16))), periodEnd: formatDate(new Date(Date.UTC(y, m + 1, 0))) };
}

export function isStandardCutoff(periodStart, periodEnd) {
  const expected = cutoffFor(periodStart);
  return expected.periodStart === periodStart && expected.periodEnd === periodEnd;
}

/**
 * Working days between two dates (inclusive) for an employee's schedule.
 * 313 = Monday–Saturday, 261 = Monday–Friday, 365 = every day.
 */
export function countWorkingDays(from, to, dailyDivisor = 313) {
  if (!from || !to || from > to) return 0;
  let count = 0;
  for (let day = parseDate(from); formatDate(day) <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    const weekday = day.getUTCDay(); // 0 = Sunday
    if (Number(dailyDivisor) === 365) count += 1;
    else if (Number(dailyDivisor) === 261) count += weekday !== 0 && weekday !== 6 ? 1 : 0;
    else count += weekday !== 0 ? 1 : 0;
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// Contributions and tax (monthly amounts)
// ---------------------------------------------------------------------------------------------

export function sssMonthly(monthlyCompensation, rates) {
  const s = rates.sss;
  if (!(monthlyCompensation > 0)) return { msc: 0, ee: 0, er: 0, ec: 0 };
  const stepped = Math.floor((monthlyCompensation + s.mscStep / 2) / s.mscStep) * s.mscStep;
  const msc = Math.min(s.maxMsc, Math.max(s.minMsc, stepped));
  return {
    msc,
    ee: round2(msc * s.employeeRate),
    er: round2(msc * s.employerRate),
    ec: msc < s.ecThresholdMsc ? s.ecLow : s.ecHigh,
  };
}

export function philhealthMonthly(monthlyCompensation, rates) {
  const p = rates.philhealth;
  if (!(monthlyCompensation > 0)) return { ee: 0, er: 0 };
  const base = Math.min(p.ceiling, Math.max(p.floor, monthlyCompensation));
  const share = round2((base * p.rate) / 2);
  return { ee: share, er: share };
}

export function pagibigMonthly(monthlyCompensation, rates) {
  const p = rates.pagibig;
  if (!(monthlyCompensation > 0)) return { ee: 0, er: 0 };
  const fundSalary = Math.min(p.maxFundSalary, monthlyCompensation);
  const eeRate = monthlyCompensation <= p.lowThreshold ? p.employeeRateLow : p.employeeRateHigh;
  return { ee: round2(fundSalary * eeRate), er: round2(fundSalary * p.employerRate) };
}

export function withholdingSemiMonthly(taxable, rates) {
  if (!(taxable > 0)) return 0;
  let bracket = rates.withholdingSemiMonthly[0];
  for (const row of rates.withholdingSemiMonthly) {
    if (taxable > row[0]) bracket = row;
  }
  const [over, base, rate] = bracket;
  return round2(base + (taxable - over) * rate);
}

// ---------------------------------------------------------------------------------------------
// One payroll line
// ---------------------------------------------------------------------------------------------

/**
 * Compute one employee's pay for one semi-monthly cut-off. Pure: no database, no clock.
 *
 * @param {object} input
 * @param {"monthly"|"daily"|"hourly"} input.payBasis
 * @param {number} input.rate             per month / day / hour, per payBasis
 * @param {number} [input.dailyDivisor]   313 | 261 | 365
 * @param {string} input.periodStart      YYYY-MM-DD
 * @param {string} input.periodEnd        YYYY-MM-DD
 * @param {string} [input.employedFrom]   employee start date (for proration)
 * @param {string|null} [input.employedTo] employee last day (for proration)
 * @param {number} [input.daysWorked]     daily staff
 * @param {number} [input.hoursWorked]    hourly staff
 * @param {number} [input.daysAbsent]     monthly staff: unpaid absences in the cut-off
 * @param {number} [input.otHours]        hours beyond 8 a day
 * @param {"per_cutoff"|"monthly"} [input.contributionSplit]
 *        per_cutoff (default): half of each monthly contribution every cut-off.
 *        monthly: nothing in the 1st cut-off; the whole month in the 2nd, on both cut-offs' pay.
 * @param {object} [input.firstCutoff] monthly split, 2nd cut-off: the same employee's 1st cut-off line
 *        ({ grossPay, sssEe, philhealthEe, pagibigEe, sssEr, ecEr, philhealthEr, pagibigEr }). The 2nd
 *        cut-off takes the month's total less whatever the 1st cut-off already took.
 */
export function computePayrollLine(input) {
  const rates = getPayrollRates(input.periodEnd);
  const divisor = Number(input.dailyDivisor || 313);
  const rate = Number(input.rate || 0);
  const daysWorked = Math.max(0, Number(input.daysWorked || 0));
  const hoursWorked = Math.max(0, Number(input.hoursWorked || 0));
  const daysAbsent = Math.max(0, Number(input.daysAbsent || 0));
  const otHours = Math.max(0, Number(input.otHours || 0));

  let dailyRate;
  let hourlyRate;
  let basicPay;
  let prorationNote = null;

  if (input.payBasis === "monthly") {
    dailyRate = (rate * 12) / divisor;
    hourlyRate = dailyRate / rates.hoursPerDay;
    const periodDays = countWorkingDays(input.periodStart, input.periodEnd, divisor);
    const from = input.employedFrom && input.employedFrom > input.periodStart ? input.employedFrom : input.periodStart;
    const to = input.employedTo && input.employedTo < input.periodEnd ? input.employedTo : input.periodEnd;
    const employedDays = countWorkingDays(from, to, divisor);
    const halfMonth = rate / 2;
    const earned = periodDays > 0 ? (halfMonth * employedDays) / periodDays : 0;
    if (employedDays < periodDays) prorationNote = `Prorated: ${employedDays} of ${periodDays} working days`;
    basicPay = Math.max(0, earned - daysAbsent * dailyRate);
  } else if (input.payBasis === "daily") {
    dailyRate = rate;
    hourlyRate = rate / rates.hoursPerDay;
    basicPay = rate * daysWorked;
  } else if (input.payBasis === "hourly") {
    hourlyRate = rate;
    dailyRate = rate * rates.hoursPerDay;
    basicPay = rate * hoursWorked;
  } else {
    throw new Error(`Unknown pay basis "${input.payBasis}".`);
  }

  basicPay = round2(basicPay);
  const otPay = round2(hourlyRate * (1 + rates.overtimePremium) * otHours);
  const grossPay = round2(basicPay + otPay);

  // per_cutoff: monthly contributions are worked out on this cut-off's pay as a monthly figure,
  // then half is deducted now (the other half in the other cut-off of the month).
  // monthly: the 1st cut-off deducts nothing; the 2nd deducts the month's total, worked out on the
  // month's actual pay (both cut-offs), less anything the 1st cut-off already deducted.
  const split = input.contributionSplit === "monthly" ? "monthly" : "per_cutoff";
  const isSecondCutoff = Number(String(input.periodStart).slice(8, 10)) > 15;
  const first = input.firstCutoff || {};
  const monthlyCompensation = split === "monthly"
    ? grossPay + Math.max(0, Number(first.grossPay || 0))
    : grossPay * 2;
  const sss = sssMonthly(monthlyCompensation, rates);
  const philhealth = philhealthMonthly(monthlyCompensation, rates);
  const pagibig = pagibigMonthly(monthlyCompensation, rates);
  const share = (monthly, key) => {
    if (split === "per_cutoff") return round2(monthly / 2);
    if (!isSecondCutoff) return 0;
    return Math.max(0, round2(monthly - Number(first[key] || 0)));
  };

  const sssEe = share(sss.ee, "sssEe");
  const philhealthEe = share(philhealth.ee, "philhealthEe");
  const pagibigEe = share(pagibig.ee, "pagibigEe");
  const employeeContributions = round2(sssEe + philhealthEe + pagibigEe);
  const withholdingTax = withholdingSemiMonthly(round2(grossPay - employeeContributions), rates);
  const netPay = round2(grossPay - employeeContributions - withholdingTax);

  const sssEr = share(sss.er, "sssEr");
  const ecEr = share(sss.ec, "ecEr");
  const philhealthEr = share(philhealth.er, "philhealthEr");
  const pagibigEr = share(pagibig.er, "pagibigEr");

  return {
    rateTableYear: rates.year,
    contributionSplit: split,
    dailyRate: round2(dailyRate),
    hourlyRate: round2(hourlyRate),
    basicPay,
    otPay,
    grossPay,
    sssEe,
    philhealthEe,
    pagibigEe,
    withholdingTax,
    netPay,
    sssEr,
    ecEr,
    philhealthEr,
    pagibigEr,
    employerContributions: round2(sssEr + ecEr + philhealthEr + pagibigEr),
    // 13th month (PD 851) = basic pay earned ÷ 12; overtime is not included.
    thirteenthMonthAccrual: round2(basicPay / 12),
    prorationNote,
  };
}

/**
 * Hours a payroll line paid for: hourly = hours entered; daily = days × 8; monthly-rated = working
 * days employed in the cut-off, less unpaid absences, × 8. Overtime hours are added on top.
 * Used for sales per labor hour.
 */
export function laborHoursOfLine(line) {
  const rates = getPayrollRates(line.periodEnd);
  const otHours = Math.max(0, Number(line.otHours || 0));
  let regular = 0;
  if (line.payBasis === "hourly") {
    regular = Math.max(0, Number(line.hoursWorked || 0));
  } else if (line.payBasis === "daily") {
    regular = Math.max(0, Number(line.daysWorked || 0)) * rates.hoursPerDay;
  } else if (line.payBasis === "monthly") {
    const from = line.employedFrom && line.employedFrom > line.periodStart ? line.employedFrom : line.periodStart;
    const to = line.employedTo && line.employedTo < line.periodEnd ? line.employedTo : line.periodEnd;
    const days = Math.max(0, countWorkingDays(from, to, line.dailyDivisor) - Math.max(0, Number(line.daysAbsent || 0)));
    regular = days * rates.hoursPerDay;
  }
  return round2(regular + otHours);
}

/**
 * A month's planned labor cost from the staff list (payroll plan P3.6 budget auto-fill). Pure.
 * Salary = monthly-rated staff (prorated for days employed); Wages = daily rate × scheduled days, or
 * hourly rate × 8 × scheduled days; contributions = employer SSS + EC + PhilHealth + Pag-IBIG on the
 * month's basic pay; 13th month = basic ÷ 12. Overtime is the owner's own cap, not planned here.
 *
 * @param {Array<{payBasis, rate, dailyDivisor, startDate, endDate}>} employees
 * @param {string} month YYYY-MM
 */
export function planMonthlyLaborBudget(employees, month) {
  const monthStart = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const monthEnd = formatDate(new Date(Date.UTC(y, m, 0)));
  const rates = getPayrollRates(monthEnd);
  let salary = 0;
  let wages = 0;
  let governmentContributions = 0;
  let thirteenthMonth = 0;
  let counted = 0;
  for (const employee of employees) {
    const rate = Number(employee.rate || 0);
    if (!(rate > 0)) continue;
    const from = employee.startDate && employee.startDate > monthStart ? employee.startDate : monthStart;
    const to = employee.endDate && employee.endDate < monthEnd ? employee.endDate : monthEnd;
    if (from > to) continue;
    const divisor = Number(employee.dailyDivisor || 313);
    const scheduledDays = countWorkingDays(from, to, divisor);
    let basic;
    if (employee.payBasis === "monthly") {
      const monthDays = countWorkingDays(monthStart, monthEnd, divisor);
      basic = monthDays > 0 ? (rate * scheduledDays) / monthDays : 0;
      salary += round2(basic);
    } else if (employee.payBasis === "daily") {
      basic = rate * scheduledDays;
      wages += round2(basic);
    } else if (employee.payBasis === "hourly") {
      basic = rate * rates.hoursPerDay * scheduledDays;
      wages += round2(basic);
    } else {
      continue;
    }
    basic = round2(basic);
    const sss = sssMonthly(basic, rates);
    const philhealth = philhealthMonthly(basic, rates);
    const pagibig = pagibigMonthly(basic, rates);
    governmentContributions += round2(sss.er + sss.ec + philhealth.er + pagibig.er);
    thirteenthMonth += round2(basic / 12);
    counted += 1;
  }
  return {
    month,
    salary: round2(salary),
    wages: round2(wages),
    governmentContributions: round2(governmentContributions),
    thirteenthMonth: round2(thirteenthMonth),
    employeesCounted: counted,
    rateTableYear: rates.year,
  };
}
