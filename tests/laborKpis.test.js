import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createNetIncomeAccessToken } from "../api/src/routes/finances.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";
import { countWorkingDays, planMonthlyLaborBudget } from "../shared/payrollComputation.js";

const round2 = (value) => Math.round(value * 100) / 100;
const CUTOFF = { start: "2026-06-01", end: "2026-06-15" };
const PLAN_MONTH = "2026-07";

describe("Labor on the dashboard, reports and budgets (payroll plan Phase 3)", () => {
  let server;
  let admin;
  let cashier;
  const tracker = createCleanupTracker();
  const employeeIds = [];
  let settingsBefore;

  async function freeCutoff() {
    await pool.execute(
      "UPDATE payroll_runs SET status = 'voided', void_reason = 'test cleanup' WHERE status <> 'voided' AND period_start = ?",
      [CUTOFF.start],
    );
  }

  before(async () => {
    server = await startTestServer();
    admin = await tracker.createUser({ role: "admin" });
    cashier = await tracker.createUser({ role: "staff" });
    const [[row]] = await pool.execute(
      "SELECT target_labor_cost, target_utilities_cost, target_occupancy_cost, contribution_split FROM business_settings WHERE id = 1",
    );
    settingsBefore = row;
    await pool.execute("UPDATE business_settings SET contribution_split = 'per_cutoff' WHERE id = 1");
    await freeCutoff();
    // Our employees must be the only ones employed in June and July 2026.
    await pool.execute(
      "UPDATE employees SET status = 'resigned', end_date = start_date WHERE start_date <= '2026-07-31' AND (end_date IS NULL OR end_date >= '2026-06-01')",
    );
    await pool.execute("UPDATE employees SET is_archived = TRUE WHERE start_date >= '2026-06-01' AND start_date <= '2026-07-31'");
  });

  after(async () => {
    try {
      await freeCutoff();
      if (employeeIds.length) {
        const marks = employeeIds.map(() => "?").join(",");
        const [runs] = await pool.execute(`SELECT DISTINCT run_id FROM payroll_lines WHERE employee_id IN (${marks})`, employeeIds);
        for (const { run_id: runId } of runs) {
          await pool.execute("UPDATE journal_entries SET payable_id = NULL WHERE payable_id IN (SELECT id FROM financial_payables WHERE payroll_run_id = ?)", [runId]);
          await pool.execute("DELETE FROM financial_payables WHERE payroll_run_id = ?", [runId]);
          await pool.execute("UPDATE payroll_runs SET accrual_journal_entry_id = NULL, void_journal_entry_id = NULL WHERE id = ?", [runId]);
          await pool.execute("UPDATE payroll_lines SET payment_journal_entry_id = NULL, thirteenth_payment_journal_entry_id = NULL WHERE run_id = ?", [runId]);
          await pool.execute("DELETE FROM payroll_runs WHERE id = ?", [runId]);
        }
        await pool.execute(`DELETE FROM employee_pay_rates WHERE employee_id IN (${marks})`, employeeIds);
        await pool.execute(`DELETE FROM employees WHERE id IN (${marks})`, employeeIds);
      }
      await pool.execute("DELETE FROM expense_budgets WHERE set_by = ?", [admin.id]);
      if (settingsBefore) {
        await pool.execute(
          "UPDATE business_settings SET target_labor_cost = ?, target_utilities_cost = ?, target_occupancy_cost = ?, contribution_split = ? WHERE id = 1",
          [settingsBefore.target_labor_cost, settingsBefore.target_utilities_cost, settingsBefore.target_occupancy_cost, settingsBefore.contribution_split],
        );
      }
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  const pin = () => ({ "X-Net-Income-Token": createNetIncomeAccessToken(admin.id) });
  const get = (path, unlocked = true) => server.requestJson(path, { token: admin.token, headers: unlocked ? pin() : {} });
  const post = (path, body) => server.requestJson(path, { method: "POST", token: admin.token, headers: pin(), body });

  async function addEmployee(body) {
    const res = await post("/api/payroll/employees", { position: "Crew", employmentStatus: "regular", dailyDivisor: 313, startDate: "2026-01-05", ...body, fullName: makeUniqueTag(body.fullName) });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    employeeIds.push(res.data.employee.id);
    return res.data.employee;
  }

  let run;
  let accrualTotal;

  it("saves and validates the cost targets and the contribution split in Settings", async () => {
    const current = await get("/api/settings");
    assert.equal(current.status, 200);
    assert.equal(typeof current.data.targetLaborCost, "number");
    const saved = await server.requestJson("/api/settings", {
      method: "PUT", token: admin.token,
      body: { ...current.data, targetLaborCost: 0.28, targetUtilitiesCost: 0.04, targetOccupancyCost: 0.09, contributionSplit: "per_cutoff" },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.targetLaborCost, 0.28);
    assert.equal(saved.data.targetUtilitiesCost, 0.04);
    assert.equal(saved.data.targetOccupancyCost, 0.09);
    const bad = await server.requestJson("/api/settings", { method: "PUT", token: admin.token, body: { ...current.data, targetLaborCost: 0.9 } });
    assert.equal(bad.status, 400);
    const badSplit = await server.requestJson("/api/settings", { method: "PUT", token: admin.token, body: { ...current.data, contributionSplit: "weekly" } });
    assert.equal(badSplit.status, 400);
  });

  it("shows labor cost, labor %, prime cost and sales per labor hour that match the P&L", async () => {
    await addEmployee({ fullName: "KPI Monthly", payBasis: "monthly", rate: 20000 });
    await addEmployee({ fullName: "KPI Cashier", payBasis: "daily", rate: 600, userId: cashier.id });

    const range = `rangeKey=custom&from=${CUTOFF.start}&to=${CUTOFF.end}`;
    const before = await get(`/api/finances/reports/profit-and-loss?from=${CUTOFF.start}&to=${CUTOFF.end}`);

    const created = await post("/api/payroll/runs", { periodStart: CUTOFF.start });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    run = created.data.run;
    assert.equal(run.contributionSplit, "per_cutoff");
    const approved = await post(`/api/payroll/runs/${run.id}/approve`, {});
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    run = approved.data.run;
    accrualTotal = round2(run.totals.gross + run.totals.employerContributions + run.totals.thirteenthMonth);

    const pnl = await get(`/api/finances/reports/profit-and-loss?from=${CUTOFF.start}&to=${CUTOFF.end}`);
    assert.equal(round2(pnl.data.laborCost - before.data.laborCost), accrualTotal, "the run's cost is in Labor");
    assert.equal(pnl.data.primeCost, round2(pnl.data.cogs + pnl.data.laborCost));

    const summary = await get(`/api/reports/financial-summary?${range}`);
    assert.equal(summary.status, 200);
    const s = summary.data.summary;
    assert.equal(s.laborLocked, false);
    assert.equal(s.laborCost, pnl.data.laborCost, "dashboard labor = P&L labor");
    assert.equal(s.primeCost, pnl.data.primeCost);
    assert.equal(s.laborPercent, pnl.data.laborPercent);
    assert.equal(s.targetLaborCost, 0.28);
    assert.equal(s.primeCostGoal, 0.6);

    const workingDays = countWorkingDays(CUTOFF.start, CUTOFF.end, 313);
    const dailyLine = run.lines.find((line) => line.payBasis === "daily");
    assert.equal(s.laborHours, round2(workingDays * 8 + Number(dailyLine.daysWorked) * 8 + Number(dailyLine.otHours || 0)));
    assert.equal(s.salesPerLaborHour, s.laborHours > 0 ? round2(s.ledgerNetSales / s.laborHours) : null);

    const locked = await get(`/api/reports/financial-summary?${range}`, false);
    assert.equal(locked.data.summary.laborLocked, true);
    for (const key of ["laborCost", "laborPercent", "primeCost", "primeCostPercent", "salesPerLaborHour", "utilitiesCost", "occupancyPercent", "controllableIncome"]) {
      assert.equal(locked.data.summary[key], null, `${key} must hide without the PIN`);
    }
    assert.equal(typeof locked.data.summary.grossProfit, "number", "existing dashboard figures are unchanged");
  });

  it("adds wages, sales per labor hour and profit after wages to Staff Performance for linked staff", async () => {
    const range = `rangeKey=custom&from=${CUTOFF.start}&to=${CUTOFF.end}`;
    const res = await get(`/api/reports/staff-performance?${range}`);
    assert.equal(res.status, 200);
    const row = res.data.staff.find((entry) => entry.userId === cashier.id);
    assert.ok(row, "the linked cashier is listed");
    const line = run.lines.find((entry) => entry.payBasis === "daily");
    const expectedCost = round2(line.grossPay + line.sssEr + line.ecEr + line.philhealthEr + line.pagibigEr + line.thirteenthMonthAccrual);
    assert.equal(row.laborCost, expectedCost);
    assert.equal(row.profitAfterWages, round2(row.attributedGrossProfit - expectedCost));

    const locked = await get(`/api/reports/staff-performance?${range}`, false);
    assert.equal(locked.data.laborLocked, true);
    assert.equal(locked.data.staff.find((entry) => entry.userId === cashier.id).laborCost, null);
  });

  it("shows payroll paid as its own cash-flow line, hidden without the PIN", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    const topUp = await post("/api/finances/journal-entries", { entryType: "capital_injection", amount: 100000, debitAccountCode: "1030", creditAccountCode: "3010", memo: "Labor KPI test funds" });
    assert.equal(topUp.status, 201, JSON.stringify(topUp.data));
    const before = await get(`/api/finances/reports/cash-flow?from=${today}&to=${today}`);
    const paid = await post(`/api/payroll/runs/${run.id}/pay`, { channel: "store_bank" });
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    const after = await get(`/api/finances/reports/cash-flow?from=${today}&to=${today}`);
    assert.equal(
      round2(after.data.operatingActivities.payrollCashOutflow - before.data.operatingActivities.payrollCashOutflow),
      run.totals.net,
    );
    assert.equal(
      round2(after.data.operatingActivities.opexCashOutflow - before.data.operatingActivities.opexCashOutflow),
      run.totals.net,
      "payroll paid is part of operating outflow, not extra",
    );
    const locked = await get(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, false);
    assert.equal(locked.data.operatingActivities.payrollCashOutflow, null);
  });

  it("fills the labor budgets from the staff list, capped by target % of 3-month average sales", async () => {
    const locked = await get(`/api/finances/expense-budgets/labor-plan?month=${PLAN_MONTH}`, false);
    assert.equal(locked.status, 403);
    assert.equal(locked.data.pinRequired, true);

    const planRes = await get(`/api/finances/expense-budgets/labor-plan?month=${PLAN_MONTH}`);
    assert.equal(planRes.status, 200, JSON.stringify(planRes.data));
    const expected = planMonthlyLaborBudget([
      { payBasis: "monthly", rate: 20000, dailyDivisor: 313, startDate: "2026-01-05", endDate: null },
      { payBasis: "daily", rate: 600, dailyDivisor: 313, startDate: "2026-01-05", endDate: null },
    ], PLAN_MONTH);
    assert.equal(planRes.data.salary, expected.salary);
    assert.equal(planRes.data.wages, expected.wages);
    assert.equal(planRes.data.governmentContributions, expected.governmentContributions);
    assert.equal(planRes.data.thirteenthMonth, expected.thirteenthMonth);
    assert.deepEqual(planRes.data.salesMonths.map((row) => row.month), ["2026-04", "2026-05", "2026-06"]);
    assert.equal(planRes.data.ceiling, round2(planRes.data.targetLaborCost * planRes.data.averageNetSales));

    const applied = await post("/api/finances/expense-budgets/labor-plan/apply", { month: PLAN_MONTH, overtimeBudget: 1500, targetLaborCost: 0.25 });
    assert.equal(applied.status, 200, JSON.stringify(applied.data));
    const [rows] = await pool.execute(
      `SELECT ec.slug, eb.budget_amount FROM expense_budgets eb JOIN expense_categories ec ON ec.id = eb.category_id
        WHERE eb.budget_month = ? AND eb.set_by = ?`,
      [`${PLAN_MONTH}-01`, admin.id],
    );
    const budgets = Object.fromEntries(rows.map((row) => [row.slug, Number(row.budget_amount)]));
    assert.equal(budgets.salary, expected.salary);
    assert.equal(budgets.wages, expected.wages);
    assert.equal(budgets["government-contributions"], expected.governmentContributions);
    assert.equal(budgets["thirteenth-month"], expected.thirteenthMonth);
    assert.equal(budgets.overtime, 1500);
    if (applied.data.plan.ceiling > 0) assert.equal(budgets["labor-and-payroll"], applied.data.plan.ceiling);
    assert.equal(applied.data.plan.targetLaborCost, 0.25);
  });
});
