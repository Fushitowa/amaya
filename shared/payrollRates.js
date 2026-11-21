/**
 * Philippine payroll rate tables, keyed by the year they take effect. When a table changes, add a
 * new year here; runs use the newest table whose year is on or before the run's period end.
 *
 * Sources (2026): SSS Circular (15% of MSC, ER 10% / EE 5%, MSC ₱5,000–₱35,000, EC ₱10 below
 * ₱15,000 MSC else ₱30); PhilHealth 5% (2.5% / 2.5%, base ₱10,000–₱100,000); Pag-IBIG 2% ER,
 * 1–2% EE, fund salary capped at ₱10,000; BIR TRAIN withholding table (2023 onwards).
 */
export const PAYROLL_RATE_TABLES = Object.freeze({
  2026: Object.freeze({
    year: 2026,
    sss: Object.freeze({
      employerRate: 0.10,
      employeeRate: 0.05,
      minMsc: 5000,
      maxMsc: 35000,
      mscStep: 500,
      ecLow: 10,
      ecHigh: 30,
      ecThresholdMsc: 15000,
    }),
    philhealth: Object.freeze({ rate: 0.05, floor: 10000, ceiling: 100000 }),
    pagibig: Object.freeze({ employerRate: 0.02, employeeRateLow: 0.01, employeeRateHigh: 0.02, lowThreshold: 1500, maxFundSalary: 10000 }),
    // Semi-monthly withholding tax table: [over, baseTax, rateOnExcess]
    withholdingSemiMonthly: Object.freeze([
      [0, 0, 0],
      [10417, 0, 0.15],
      [16667, 937.5, 0.20],
      [33333, 4270.7, 0.25],
      [83333, 16770.7, 0.30],
      [333333, 91770.7, 0.35],
    ]),
    overtimePremium: 0.25,
    hoursPerDay: 8,
  }),
});

export function getPayrollRates(dateString) {
  const year = Number(String(dateString || "").slice(0, 4));
  const years = Object.keys(PAYROLL_RATE_TABLES).map(Number).sort((a, b) => a - b);
  const usable = years.filter((y) => y <= year);
  if (!usable.length) {
    throw new Error(`No payroll rate table covers ${dateString}. Add one to shared/payrollRates.js.`);
  }
  return PAYROLL_RATE_TABLES[usable.at(-1)];
}
