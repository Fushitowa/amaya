import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computePayrollLine,
  countWorkingDays,
  laborHoursOfLine,
  planMonthlyLaborBudget,
  cutoffFor,
  isStandardCutoff,
  pagibigMonthly,
  philhealthMonthly,
  sssMonthly,
  withholdingSemiMonthly,
} from "../shared/payrollComputation.js";
import { getPayrollRates } from "../shared/payrollRates.js";

const rates = getPayrollRates("2026-03-15");
const base = { periodStart: "2026-03-01", periodEnd: "2026-03-15", dailyDivisor: 313 };

describe("Payroll computation (payroll plan P2.1)", () => {
  it("finds the semi-monthly cut-off for any date", () => {
    assert.deepEqual(cutoffFor("2026-02-20"), { periodStart: "2026-02-16", periodEnd: "2026-02-28" });
    assert.deepEqual(cutoffFor("2026-03-15"), { periodStart: "2026-03-01", periodEnd: "2026-03-15" });
    assert.deepEqual(cutoffFor("2026-12-31"), { periodStart: "2026-12-16", periodEnd: "2026-12-31" });
    assert.equal(isStandardCutoff("2026-03-01", "2026-03-15"), true);
    assert.equal(isStandardCutoff("2026-03-01", "2026-03-20"), false);
  });

  it("counts working days by schedule (313 = Mon–Sat, 261 = Mon–Fri, 365 = every day)", () => {
    // 2026-03-01 is a Sunday; Sundays fall on the 1st, 8th and 15th.
    assert.equal(countWorkingDays("2026-03-01", "2026-03-15", 313), 12);
    assert.equal(countWorkingDays("2026-03-01", "2026-03-15", 261), 10);
    assert.equal(countWorkingDays("2026-03-01", "2026-03-15", 365), 15);
  });

  it("works out a full cut-off for a monthly-rated employee", () => {
    const line = computePayrollLine({ ...base, payBasis: "monthly", rate: 17500 });
    assert.equal(line.basicPay, 8750);
    assert.equal(line.otPay, 0);
    // Monthly comp 17,500 → MSC 17,500: EE 875 / ER 1,750 / EC 30, halved per cut-off.
    assert.equal(line.sssEe, 437.5);
    assert.equal(line.sssEr, 875);
    assert.equal(line.ecEr, 15);
    assert.equal(line.philhealthEe, 218.75);
    assert.equal(line.philhealthEr, 218.75);
    assert.equal(line.pagibigEe, 100);
    assert.equal(line.pagibigEr, 100);
    assert.equal(line.withholdingTax, 0, "below the ₱10,417 semi-monthly threshold");
    assert.equal(line.netPay, 7993.75);
    assert.equal(line.thirteenthMonthAccrual, 729.17);
  });

  it("deducts absences and prorates a mid-period start for monthly staff", () => {
    const daily = (17500 * 12) / 313;
    const absent = computePayrollLine({ ...base, payBasis: "monthly", rate: 17500, daysAbsent: 1 });
    assert.equal(absent.basicPay, Math.round((8750 - daily) * 100) / 100);
    const late = computePayrollLine({ ...base, payBasis: "monthly", rate: 17500, employedFrom: "2026-03-09" });
    // Employed Mar 9–15: 6 of 12 working days.
    assert.equal(late.basicPay, Math.round(((8750 * 6) / 12) * 100) / 100);
    assert.match(late.prorationNote, /6 of 12/);
  });

  it("pays daily and hourly staff for time worked, overtime at +25%", () => {
    const daily = computePayrollLine({ ...base, payBasis: "daily", rate: 600, daysWorked: 12, otHours: 4 });
    assert.equal(daily.basicPay, 7200);
    assert.equal(daily.otPay, 375, "600 ÷ 8 × 1.25 × 4");
    assert.equal(daily.grossPay, 7575);
    assert.equal(daily.thirteenthMonthAccrual, 600, "13th month ignores overtime");

    const hourly = computePayrollLine({ ...base, payBasis: "hourly", rate: 80, hoursWorked: 40, otHours: 2 });
    assert.equal(hourly.basicPay, 3200);
    assert.equal(hourly.otPay, 200);
  });

  it("caps contributions at the 2026 ceilings", () => {
    assert.deepEqual(sssMonthly(80000, rates), { msc: 35000, ee: 1750, er: 3500, ec: 30 });
    assert.deepEqual(sssMonthly(3000, rates), { msc: 5000, ee: 250, er: 500, ec: 10 });
    assert.equal(sssMonthly(5249, rates).msc, 5000);
    assert.equal(sssMonthly(5250, rates).msc, 5500);
    assert.deepEqual(philhealthMonthly(150000, rates), { ee: 2500, er: 2500 });
    assert.deepEqual(philhealthMonthly(8000, rates), { ee: 250, er: 250 }, "₱10,000 floor");
    assert.deepEqual(pagibigMonthly(30000, rates), { ee: 200, er: 200 });
    assert.deepEqual(pagibigMonthly(1500, rates), { ee: 15, er: 30 }, "1% employee share at ₱1,500 and below");
    assert.deepEqual(sssMonthly(0, rates), { msc: 0, ee: 0, er: 0, ec: 0 }, "no pay, no contribution");
  });

  it("applies the semi-monthly withholding tax table", () => {
    assert.equal(withholdingSemiMonthly(10417, rates), 0);
    assert.equal(withholdingSemiMonthly(12000, rates), Math.round((12000 - 10417) * 0.15 * 100) / 100);
    assert.equal(withholdingSemiMonthly(20000, rates), Math.round((937.5 + (20000 - 16667) * 0.2) * 100) / 100);
    const high = computePayrollLine({ ...base, payBasis: "monthly", rate: 60000 });
    assert.ok(high.withholdingTax > 0);
    assert.equal(high.netPay, Math.round((high.grossPay - high.sssEe - high.philhealthEe - high.pagibigEe - high.withholdingTax) * 100) / 100);
  });

  it("refuses a year with no rate table", () => {
    assert.throws(() => computePayrollLine({ payBasis: "daily", rate: 500, periodStart: "2025-03-01", periodEnd: "2025-03-15" }), /No payroll rate table/);
  });
});

describe("Monthly contribution split (payroll plan P3.1)", () => {
  const monthly = { payBasis: "monthly", rate: 20000, dailyDivisor: 313 };
  const first = computePayrollLine({ ...monthly, periodStart: "2026-03-01", periodEnd: "2026-03-15", contributionSplit: "monthly" });
  const second = computePayrollLine({ ...monthly, periodStart: "2026-03-16", periodEnd: "2026-03-31", contributionSplit: "monthly", firstCutoff: first });
  const halfA = computePayrollLine({ ...monthly, periodStart: "2026-03-01", periodEnd: "2026-03-15" });
  const halfB = computePayrollLine({ ...monthly, periodStart: "2026-03-16", periodEnd: "2026-03-31" });

  it("deducts nothing in the 1st cut-off", () => {
    assert.equal(first.contributionSplit, "monthly");
    for (const key of ["sssEe", "philhealthEe", "pagibigEe", "sssEr", "ecEr", "philhealthEr", "pagibigEr"]) assert.equal(first[key], 0, key);
    assert.equal(first.netPay, Number((first.grossPay - first.withholdingTax).toFixed(2)));
  });

  it("deducts the whole month in the 2nd cut-off, on both cut-offs' pay", () => {
    const monthPay = first.grossPay + second.grossPay;
    const r = getPayrollRates("2026-03-31");
    assert.equal(second.sssEe, sssMonthly(monthPay, r).ee);
    assert.equal(second.sssEr, sssMonthly(monthPay, r).er);
    assert.equal(second.ecEr, sssMonthly(monthPay, r).ec);
    assert.equal(second.philhealthEe, philhealthMonthly(monthPay, r).ee);
    assert.equal(second.pagibigEe, pagibigMonthly(monthPay, r).ee);
  });

  it("takes the same month total as the half-per-cut-off default for a steady salary", () => {
    const total = (a, b) => Number((a + b).toFixed(2));
    assert.equal(total(first.sssEe, second.sssEe), total(halfA.sssEe, halfB.sssEe));
    assert.equal(total(first.philhealthEr, second.philhealthEr), total(halfA.philhealthEr, halfB.philhealthEr));
  });

  it("subtracts what the 1st cut-off already deducted when the setting changed mid-month", () => {
    const afterSwitch = computePayrollLine({ ...monthly, periodStart: "2026-03-16", periodEnd: "2026-03-31", contributionSplit: "monthly", firstCutoff: halfA });
    const r = getPayrollRates("2026-03-31");
    const monthTotal = sssMonthly(halfA.grossPay + afterSwitch.grossPay, r).ee;
    assert.equal(Number((halfA.sssEe + afterSwitch.sssEe).toFixed(2)), monthTotal);
  });
});

describe("Labor hours and the monthly labor budget plan (payroll plan P3.2 / P3.6)", () => {
  it("counts paid hours per pay basis plus overtime", () => {
    const period = { periodStart: "2026-03-01", periodEnd: "2026-03-15", dailyDivisor: 313 };
    assert.equal(laborHoursOfLine({ ...period, payBasis: "hourly", hoursWorked: 37.5, otHours: 2 }), 39.5);
    assert.equal(laborHoursOfLine({ ...period, payBasis: "daily", daysWorked: 10, otHours: 1 }), 81);
    const workingDays = countWorkingDays("2026-03-01", "2026-03-15", 313);
    assert.equal(laborHoursOfLine({ ...period, payBasis: "monthly", daysAbsent: 1 }), (workingDays - 1) * 8);
    assert.equal(laborHoursOfLine({ ...period, payBasis: "monthly", employedFrom: "2026-03-09" }), countWorkingDays("2026-03-09", "2026-03-15", 313) * 8);
  });

  it("plans salary, wages, employer contributions and 13th month from the staff list", () => {
    const days = countWorkingDays("2026-07-01", "2026-07-31", 313);
    const plan = planMonthlyLaborBudget([
      { payBasis: "monthly", rate: 20000, dailyDivisor: 313, startDate: "2026-01-05", endDate: null },
      { payBasis: "daily", rate: 600, dailyDivisor: 313, startDate: "2026-01-05", endDate: null },
      { payBasis: "hourly", rate: 80, dailyDivisor: 313, startDate: "2026-01-05", endDate: null },
      { payBasis: "daily", rate: 600, dailyDivisor: 313, startDate: "2026-08-01", endDate: null },
    ], "2026-07");
    const r = getPayrollRates("2026-07-31");
    assert.equal(plan.employeesCounted, 3, "someone starting next month is not planned");
    assert.equal(plan.salary, 20000);
    assert.equal(plan.wages, 600 * days + 80 * 8 * days);
    const employerShare = (basic) => {
      const sss = sssMonthly(basic, r);
      return sss.er + sss.ec + philhealthMonthly(basic, r).er + pagibigMonthly(basic, r).er;
    };
    const expectedContrib = [20000, 600 * days, 80 * 8 * days].reduce((sum, basic) => sum + employerShare(basic), 0);
    assert.equal(plan.governmentContributions, Number(expectedContrib.toFixed(2)));
    assert.equal(plan.thirteenthMonth, Number(((20000 + 600 * days + 640 * days) / 12).toFixed(2)));
  });

  it("prorates a monthly-rated employee who leaves mid-month", () => {
    const plan = planMonthlyLaborBudget([{ payBasis: "monthly", rate: 20000, dailyDivisor: 313, startDate: "2026-01-05", endDate: "2026-07-15" }], "2026-07");
    const expected = (20000 * countWorkingDays("2026-07-01", "2026-07-15", 313)) / countWorkingDays("2026-07-01", "2026-07-31", 313);
    assert.equal(plan.salary, Number(expected.toFixed(2)));
  });
});
