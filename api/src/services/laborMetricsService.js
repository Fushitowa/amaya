import pool from "../database.js";
import { round2 } from "../utils/ledgerService.js";
import { formatDbDateOnly } from "../../../shared/manilaDate.js";
import { laborHoursOfLine } from "../../../shared/payrollComputation.js";
import { COST_TARGETS, PRIME_COST_GOAL, normalizeCostTarget } from "../../../shared/costTargets.js";
import { getProfitAndLossReport } from "./financesReportService.js";

/**
 * Labor and running-cost ratios for a date range (payroll plan P3.2 / O3.8). Every money figure
 * comes from the ledger P&L for the same dates, so the dashboard always matches the P&L.
 * Labor hours come from approved / paid payroll runs whose cut-off ends inside the range — the
 * same runs whose cost is in the P&L, because a run's accrual is dated on its last day.
 */

function lineRow(row) {
  return {
    payBasis: row.pay_basis,
    periodStart: formatDbDateOnly(row.period_start),
    periodEnd: formatDbDateOnly(row.period_end),
    employedFrom: row.start_date ? formatDbDateOnly(row.start_date) : undefined,
    employedTo: row.end_date ? formatDbDateOnly(row.end_date) : null,
    dailyDivisor: Number(row.daily_divisor),
    daysWorked: Number(row.days_worked),
    hoursWorked: Number(row.hours_worked),
    daysAbsent: Number(row.days_absent),
    otHours: Number(row.ot_hours),
  };
}

/** Payroll lines (approved or paid runs) whose cut-off ends within [from, to]; null = no bound. */
export async function loadPayrollLinesInRange(from, to, executor = pool) {
  const conditions = ["r.status IN ('approved', 'paid')"];
  const params = [];
  if (from) {
    conditions.push("r.period_end >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("r.period_end <= ?");
    params.push(to);
  }
  const [rows] = await executor.execute(
    `SELECT pl.employee_id, e.user_id, pl.pay_basis, pl.daily_divisor, pl.days_worked, pl.hours_worked,
            pl.days_absent, pl.ot_hours, pl.gross_pay, pl.sss_er, pl.ec_er, pl.philhealth_er, pl.pagibig_er,
            pl.thirteenth_month_accrual, r.period_start, r.period_end, e.start_date, e.end_date
       FROM payroll_lines pl
       JOIN payroll_runs r ON r.id = pl.run_id
       JOIN employees e ON e.id = pl.employee_id
      WHERE ${conditions.join(" AND ")}`,
    params,
  );
  return rows.map((row) => ({
    employeeId: Number(row.employee_id),
    userId: row.user_id == null ? null : Number(row.user_id),
    hours: laborHoursOfLine(lineRow(row)),
    // Employer cost of the line: gross pay + employer contributions + 13th month accrual.
    cost: round2(
      Number(row.gross_pay) + Number(row.sss_er) + Number(row.ec_er) + Number(row.philhealth_er)
        + Number(row.pagibig_er) + Number(row.thirteenth_month_accrual),
    ),
  }));
}

export async function loadCostTargets(executor = pool) {
  const [[row]] = await executor.execute(
    "SELECT target_labor_cost, target_utilities_cost, target_occupancy_cost FROM business_settings WHERE id = 1 LIMIT 1",
  );
  return Object.fromEntries(
    Object.entries(COST_TARGETS).map(([key, def]) => [key, normalizeCostTarget(key, row?.[def.column])]),
  );
}

export async function queryLaborMetrics(from, to) {
  const [pnl, lines, targets] = await Promise.all([
    getProfitAndLossReport(from || undefined, to || undefined),
    loadPayrollLinesInRange(from, to),
    loadCostTargets(),
  ]);
  const laborHours = round2(lines.reduce((sum, line) => sum + line.hours, 0));
  return {
    // Ledger basis: same figures as Finances → Profit & Loss for these dates.
    ledgerNetSales: pnl.netSales,
    laborCost: pnl.laborCost,
    laborPercent: pnl.laborPercent,
    primeCost: pnl.primeCost,
    primeCostPercent: pnl.primeCostPercent,
    laborHours,
    salesPerLaborHour: laborHours > 0 ? round2(pnl.netSales / laborHours) : null,
    utilitiesCost: pnl.utilitiesCost,
    utilitiesPercent: pnl.utilitiesPercent,
    totalOccupancy: pnl.totalOccupancy,
    occupancyPercent: pnl.occupancyPercent,
    controllableIncome: pnl.controllableIncome,
    controllableIncomePercent: pnl.controllableIncomePercent,
    targetLaborCost: targets.targetLaborCost,
    targetUtilitiesCost: targets.targetUtilitiesCost,
    targetOccupancyCost: targets.targetOccupancyCost,
    primeCostGoal: PRIME_COST_GOAL,
  };
}
