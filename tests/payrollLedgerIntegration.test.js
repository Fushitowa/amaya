import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createNetIncomeAccessToken } from "../api/src/routes/finances.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";
import { computePayrollLine } from "../shared/payrollComputation.js";

const round2 = (value) => Math.round(value * 100) / 100;
const FIRST = { start: "2026-03-01", end: "2026-03-15" };
const SECOND = { start: "2026-03-16", end: "2026-03-31" };

describe("Payroll runs post to the ledger (payroll plan P2.2–P2.8)", () => {
  let server;
  let admin;
  const tracker = createCleanupTracker();
  const employeeIds = [];
  const runIds = new Set();

  // Free the test cut-offs: a run left behind by an earlier, interrupted test run would block them.
  async function freeCutoffs() {
    await pool.execute(
      `UPDATE payroll_runs SET status = 'voided', void_reason = 'test cleanup'
        WHERE status <> 'voided' AND period_start IN (?, ?)`,
      [FIRST.start, SECOND.start],
    );
  }

  before(async () => {
    server = await startTestServer();
    admin = await tracker.createUser({ role: "admin" });
    await freeCutoffs();
    // Our employees must be the only ones employed in March 2026.
    await pool.execute(
      "UPDATE employees SET status = 'resigned', end_date = start_date WHERE start_date <= '2026-03-31' AND (end_date IS NULL OR end_date >= '2026-03-01')",
    ).catch(() => {});
  });

  after(async () => {
    try {
      await freeCutoffs();
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
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  const pin = () => ({ "X-Net-Income-Token": createNetIncomeAccessToken(admin.id) });
  const api = (path, options = {}) => server.requestJson(`/api/payroll${path}`, { token: admin.token, headers: pin(), ...options });

  async function addEmployee(body) {
    const res = await api("/employees", { method: "POST", body: { position: "Crew", employmentStatus: "regular", dailyDivisor: 313, ...body, fullName: makeUniqueTag(body.fullName) } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    employeeIds.push(res.data.employee.id);
    return res.data.employee;
  }

  async function entryLines(entryId) {
    const [rows] = await pool.execute(
      `SELECT coa.account_code AS code, SUM(jel.debit) AS debit, SUM(jel.credit) AS credit
         FROM journal_entry_lines jel JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id = ? GROUP BY coa.account_code`,
      [entryId],
    );
    return Object.fromEntries(rows.map((r) => [r.code, { debit: Number(r.debit), credit: Number(r.credit) }]));
  }

  async function bankBalance() {
    const [[row]] = await pool.execute(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS b FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id WHERE coa.account_code = '1030'`,
    );
    return round2(Number(row.b));
  }

  let monthly;
  let daily;
  let hourly;
  let run;

  it("needs the Owner PIN", async () => {
    const res = await server.requestJson("/api/payroll/runs", { token: admin.token });
    assert.equal(res.status, 403);
    assert.equal(res.data.pinRequired, true);
  });

  it("creates a draft from the staff list with prorated and pre-filled lines", async () => {
    monthly = await addEmployee({ fullName: "Monthly", payBasis: "monthly", rate: 20000, startDate: "2026-01-05" });
    daily = await addEmployee({ fullName: "Daily", payBasis: "daily", rate: 600, startDate: "2026-03-09" });
    hourly = await addEmployee({ fullName: "Hourly", payBasis: "hourly", rate: 80, startDate: "2026-01-05" });

    // A capital top-up so the bank can pay staff in this test.
    const topUp = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "capital_injection", amount: 100000, debitAccountCode: "1030", creditAccountCode: "3010", memo: "Payroll test funds" },
    });
    assert.equal(topUp.status, 201, JSON.stringify(topUp.data));

    const created = await api("/runs", { method: "POST", body: { periodStart: "2026-03-10" } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    run = created.data.run;
    runIds.add(run.id);
    assert.equal(run.periodStart, FIRST.start);
    assert.equal(run.periodEnd, FIRST.end);
    assert.equal(run.status, "draft");
    assert.equal(run.lines.length, 3);

    const byEmployee = (id) => run.lines.find((line) => line.employeeId === id);
    assert.equal(byEmployee(daily.id).daysWorked, 6, "scheduled Mon–Sat from Mar 9");
    assert.match(byEmployee(daily.id).prefillNote, /Scheduled days/);
    assert.equal(byEmployee(hourly.id).hoursWorked, 0);

    const dup = await api("/runs", { method: "POST", body: { periodStart: "2026-03-02" } });
    assert.equal(dup.status, 409, "one live run per cut-off");
  });

  it("recomputes a line when days or hours are edited", async () => {
    const hourlyLine = run.lines.find((line) => line.employeeId === hourly.id);
    const monthlyLine = run.lines.find((line) => line.employeeId === monthly.id);
    let res = await api(`/runs/${run.id}/lines/${hourlyLine.id}`, { method: "PATCH", body: { hoursWorked: 40, otHours: 2 } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    res = await api(`/runs/${run.id}/lines/${monthlyLine.id}`, { method: "PATCH", body: { daysAbsent: 1 } });
    run = res.data.run;
    const line = run.lines.find((l) => l.employeeId === hourly.id);
    const expected = computePayrollLine({ payBasis: "hourly", rate: 80, dailyDivisor: 313, periodStart: FIRST.start, periodEnd: FIRST.end, hoursWorked: 40, otHours: 2 });
    assert.equal(line.grossPay, expected.grossPay);
    assert.equal(line.netPay, expected.netPay);
    const bad = await api(`/runs/${run.id}/lines/${line.id}`, { method: "PATCH", body: { hoursWorked: -1 } });
    assert.equal(bad.status, 400);
  });

  it("approves into one balanced accrual entry and three payables", async () => {
    const res = await api(`/runs/${run.id}/approve`, { method: "POST", body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    run = res.data.run;
    assert.equal(run.status, "approved");

    const lines = await entryLines(run.accrualJournalEntryId);
    const debit = round2(Object.values(lines).reduce((s, l) => s + l.debit, 0));
    const credit = round2(Object.values(lines).reduce((s, l) => s + l.credit, 0));
    assert.equal(debit, credit, "entry balances");

    const sum = (pick) => round2(run.lines.reduce((s, l) => s + pick(l), 0));
    const m = run.lines.find((l) => l.employeeId === monthly.id);
    assert.equal(lines["6111"].debit, m.basicPay, "salary = monthly staff basic pay");
    assert.equal(lines["6115"].debit, sum((l) => (l.payBasis !== "monthly" ? l.basicPay : 0)), "wages = daily + hourly basic pay");
    assert.equal(lines["6116"].debit, sum((l) => l.otPay));
    assert.equal(lines["6112"].debit, sum((l) => l.sssEr + l.ecEr + l.philhealthEr + l.pagibigEr));
    assert.equal(lines["6114"].debit, sum((l) => l.thirteenthMonthAccrual));
    assert.equal(lines["2040"].credit, run.totals.net);
    assert.equal(lines["2050"].credit, round2(run.totals.employeeContributions + run.totals.employerContributions));
    assert.equal(lines["2045"].credit, run.totals.thirteenthMonth);

    const codes = run.payables.map((p) => p.accountCode).sort();
    assert.deepEqual(codes, run.totals.withholdingTax > 0 ? ["2040", "2050", "2060"] : ["2040", "2050"]);

    const edit = await api(`/runs/${run.id}/lines/${run.lines[0].id}`, { method: "PATCH", body: { daysWorked: 1 } });
    assert.equal(edit.status, 409, "approved lines are locked");
  });

  it("keeps the general ledger screens from bypassing payroll", async () => {
    const reverse = await server.requestJson(`/api/finances/journal-entries/${run.accrualJournalEntryId}/reverse`, { method: "POST", token: admin.token, body: { reason: "x" } });
    assert.equal(reverse.status, 409);
    const net = run.payables.find((p) => p.accountCode === "2040");
    const settle = await server.requestJson(`/api/finances/payables/${net.id}/settle`, { method: "POST", token: admin.token, body: { amount: 1, paymentAccountCode: "1030" } });
    assert.equal(settle.status, 409);
  });

  it("pays one employee, refuses to void, undoes the payment, then pays everyone", async () => {
    const before = await bankBalance();
    const m = run.lines.find((l) => l.employeeId === monthly.id);
    let res = await api(`/runs/${run.id}/pay`, { method: "POST", body: { channel: "store_bank", lineIds: [m.id] } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    run = res.data.run;
    assert.equal(round2(before - (await bankBalance())), m.netPay, "bank goes down by the net pay");
    assert.equal(run.payables.find((p) => p.accountCode === "2040").status, "partial");

    const voidTry = await api(`/runs/${run.id}/void`, { method: "POST", body: { reason: "test" } });
    assert.equal(voidTry.status, 409);

    res = await api(`/runs/${run.id}/lines/${m.id}/unpay`, { method: "POST", body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(await bankBalance(), before, "undo puts the money back");

    res = await api(`/runs/${run.id}/pay`, { method: "POST", body: { channel: "store_bank" } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    run = res.data.run;
    assert.equal(run.status, "paid");
    assert.equal(run.payables.find((p) => p.accountCode === "2040").status, "paid");
    assert.ok(run.lines.every((l) => l.paidAt));
  });

  it("voids a run by reversing it once payments are undone", async () => {
    for (const line of run.lines.filter((l) => l.paidAt)) {
      const res = await api(`/runs/${run.id}/lines/${line.id}/unpay`, { method: "POST", body: {} });
      assert.equal(res.status, 200, JSON.stringify(res.data));
    }
    const res = await api(`/runs/${run.id}/void`, { method: "POST", body: { reason: "Wrong hours" } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.run.status, "voided");
    assert.ok(res.data.run.payables.every((p) => p.status === "voided"));

    const [[{ net }]] = await pool.execute(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS net FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE je.id = ? OR je.reverses_entry_id = ?`,
      [run.accrualJournalEntryId, run.accrualJournalEntryId],
    );
    assert.equal(Number(net), 0);
    const [[rev]] = await pool.execute("SELECT COUNT(*) AS n FROM journal_entries WHERE reverses_entry_id = ?", [run.accrualJournalEntryId]);
    assert.equal(Number(rev.n), 1);

    const again = await api("/runs", { method: "POST", body: { periodStart: FIRST.start } });
    assert.equal(again.status, 201, "a voided cut-off can be run again");
    runIds.add(again.data.run.id);
    run = again.data.run;
  });

  it("accrues the 13th month and pays it out per employee", async () => {
    let res = await api(`/runs/${run.id}/approve`, { method: "POST", body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const second = await api("/runs", { method: "POST", body: { periodStart: SECOND.start } });
    assert.equal(second.status, 201, JSON.stringify(second.data));
    runIds.add(second.data.run.id);
    res = await api(`/runs/${second.data.run.id}/approve`, { method: "POST", body: {} });
    assert.equal(res.status, 200, JSON.stringify(res.data));

    const report = await api("/thirteenth-month?year=2026");
    assert.equal(report.status, 200);
    const row = report.data.items.find((item) => item.employeeId === monthly.id);
    // basic ÷ 12, rounded per run, so it can be a centavo off the yearly figure.
    assert.ok(Math.abs(row.accrued - row.basicPayEarned / 12) < 0.02, `${row.accrued} ≈ ${row.basicPayEarned / 12}`);

    const pay = await api("/thirteenth-month/pay", { method: "POST", body: { year: 2026, employeeId: monthly.id, channel: "store_bank" } });
    assert.equal(pay.status, 200, JSON.stringify(pay.data));
    assert.equal(pay.data.amount, row.accrued);
    const after = await api("/thirteenth-month?year=2026");
    assert.equal(after.data.items.find((item) => item.employeeId === monthly.id).unpaid, 0);

    const voidTry = await api(`/runs/${run.id}/void`, { method: "POST", body: { reason: "test" } });
    assert.equal(voidTry.status, 409, "a run whose 13th month was paid cannot be voided");

    const undo = await api("/thirteenth-month/undo", { method: "POST", body: { year: 2026, employeeId: monthly.id } });
    assert.equal(undo.status, 200, JSON.stringify(undo.data));
  });
});
