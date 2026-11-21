import { Router } from "express";
import pool from "../database.js";
import { httpError } from "../middleware/auth.js";
import {
  generateEntryNumber,
  getManilaDateString,
  isValidIsoDateOnly,
  postBalancedEntry,
  resolveActiveSessionId,
  round2,
} from "../utils/ledgerService.js";
import { parsePositiveIntId } from "../utils/validation.js";
import { formatDbDateOnly } from "../../../shared/manilaDate.js";
import { computePayrollLine, countWorkingDays, cutoffFor, isStandardCutoff } from "../../../shared/payrollComputation.js";
import { getPayrollRates } from "../../../shared/payrollRates.js";
import { normalizeContributionSplit } from "../../../shared/costTargets.js";
import { hasValidNetIncomeAccess } from "./finances.js";

/**
 * Payroll — Phase 2: payroll runs (semi-monthly cut-offs), approval into the ledger, paying staff,
 * voiding, and the 13th month payout. Mounted inside routes/payroll.js (admin only).
 *
 * Ledger:
 *   Approve  (operating_expense)  Dr 6111/6115/6116/6112/6114  Cr 2040/2050/2060/2045
 *   Pay      (ap_settlement)      Dr 2040  Cr 1010/1020/1030   (one entry per employee)
 *   13th     (ap_settlement)      Dr 2045  Cr 1010/1020/1030
 *   Void     (void_reversal)      mirror of the approve entry
 * Payroll money reveals labor cost, so every route here needs the Owner PIN (Net Income token).
 */
const router = Router();

const CHANNEL_ACCOUNTS = { cash_counter: "1010", gcash: "1020", store_bank: "1030" };
const CHANNEL_LABELS = { cash_counter: "cash drawer", gcash: "GCash", store_bank: "bank" };

router.use(["/runs", "/thirteenth-month", "/owner-pay"], (request, response, next) => {
  if (!hasValidNetIncomeAccess(request)) {
    return response.status(403).json({ message: "Enter the Owner PIN to open payroll. Payroll amounts are private.", pinRequired: true });
  }
  return next();
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function inTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function cleanChannel(value) {
  const channel = String(value || "");
  if (!CHANNEL_ACCOUNTS[channel]) throw httpError(400, "Choose how you paid: cash drawer, GCash or bank.");
  return channel;
}

function cleanHours(value, label, max) {
  if (value === undefined) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > max) throw httpError(400, `${label} must be between 0 and ${max}.`);
  if (Math.abs(num * 100 - Math.round(num * 100)) > 1e-6) throw httpError(400, `${label} can have at most 2 decimals.`);
  return round2(num);
}

const minDate = (a, b) => (a < b ? a : b);

/** Rate in force on `date` (latest effective_from on or before it; newest id wins a tie). */
async function rateOn(connection, employeeId, date) {
  const [[row]] = await connection.execute(
    `SELECT rate FROM employee_pay_rates WHERE employee_id = ? AND effective_from <= ?
      ORDER BY effective_from DESC, id DESC LIMIT 1`,
    [employeeId, date],
  );
  return row ? Number(row.rate) : null;
}

/** Days / hours / OT from closed POS shifts of a linked login, split per Manila calendar day. */
async function shiftAttendance(connection, userId, periodStart, periodEnd) {
  const [rows] = await connection.execute(
    `SELECT DATE(opened_at) AS work_day, SUM(TIMESTAMPDIFF(MINUTE, opened_at, closed_at)) AS minutes, COUNT(*) AS shifts
       FROM cashier_sessions
      WHERE user_id = ? AND status = 'closed' AND closed_at IS NOT NULL
        AND opened_at >= ? AND opened_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY DATE(opened_at)`,
    [userId, `${periodStart} 00:00:00`, periodEnd],
  );
  let days = 0;
  let regularHours = 0;
  let otHours = 0;
  let shifts = 0;
  for (const row of rows) {
    const hours = Math.max(0, Number(row.minutes || 0)) / 60;
    if (hours <= 0) continue;
    days += 1;
    shifts += Number(row.shifts || 0);
    regularHours += Math.min(8, hours);
    otHours += Math.max(0, hours - 8);
  }
  return { days, regularHours: round2(regularHours), otHours: round2(otHours), shifts };
}

function lineInput(line, periodStart, periodEnd, employee) {
  return {
    payBasis: line.pay_basis,
    rate: Number(line.rate),
    dailyDivisor: Number(line.daily_divisor),
    periodStart,
    periodEnd,
    employedFrom: employee ? formatDbDateOnly(employee.start_date) : undefined,
    employedTo: employee?.end_date ? formatDbDateOnly(employee.end_date) : null,
    daysWorked: Number(line.days_worked),
    hoursWorked: Number(line.hours_worked),
    daysAbsent: Number(line.days_absent),
    otHours: Number(line.ot_hours),
  };
}

async function writeComputedLine(connection, lineId, result) {
  if (result.netPay < 0) throw httpError(400, "Deductions are larger than the pay for this line. Check the days and hours.");
  await connection.execute(
    `UPDATE payroll_lines SET basic_pay = ?, ot_pay = ?, gross_pay = ?, sss_ee = ?, philhealth_ee = ?, pagibig_ee = ?,
            withholding_tax = ?, net_pay = ?, sss_er = ?, ec_er = ?, philhealth_er = ?, pagibig_er = ?,
            thirteenth_month_accrual = ?, proration_note = ?
      WHERE id = ?`,
    [result.basicPay, result.otPay, result.grossPay, result.sssEe, result.philhealthEe, result.pagibigEe,
      result.withholdingTax, result.netPay, result.sssEr, result.ecEr, result.philhealthEr, result.pagibigEr,
      result.thirteenthMonthAccrual, result.prorationNote, lineId],
  );
}

/** The 1st cut-off (1–15) lines of `month` (YYYY-MM) from its live run, by employee. */
async function loadFirstCutoffLines(connection, month) {
  const [rows] = await connection.execute(
    `SELECT pl.employee_id, pl.gross_pay, pl.sss_ee, pl.philhealth_ee, pl.pagibig_ee,
            pl.sss_er, pl.ec_er, pl.philhealth_er, pl.pagibig_er
       FROM payroll_lines pl
       JOIN payroll_runs r ON r.id = pl.run_id
      WHERE r.status <> 'voided' AND r.period_start = ?`,
    [`${month}-01`],
  );
  return new Map(rows.map((row) => [Number(row.employee_id), {
    grossPay: Number(row.gross_pay),
    sssEe: Number(row.sss_ee),
    philhealthEe: Number(row.philhealth_ee),
    pagibigEe: Number(row.pagibig_ee),
    sssEr: Number(row.sss_er),
    ecEr: Number(row.ec_er),
    philhealthEr: Number(row.philhealth_er),
    pagibigEr: Number(row.pagibig_er),
  }]));
}

/** Recompute every line of a run from its stored inputs and refresh the run totals. */
async function recomputeRun(connection, run) {
  const periodStart = formatDbDateOnly(run.period_start);
  const periodEnd = formatDbDateOnly(run.period_end);
  const [lines] = await connection.execute(
    `SELECT pl.*, e.start_date, e.end_date FROM payroll_lines pl JOIN employees e ON e.id = pl.employee_id WHERE pl.run_id = ?`,
    [run.id],
  );
  // Drafts follow the current setting; approved runs are never recomputed, so they keep theirs.
  const [[settingsRow]] = await connection.execute("SELECT contribution_split FROM business_settings WHERE id = 1");
  const contributionSplit = normalizeContributionSplit(settingsRow?.contribution_split);
  const firstCutoffLines = contributionSplit === "monthly" && Number(periodStart.slice(8, 10)) > 15
    ? await loadFirstCutoffLines(connection, periodStart.slice(0, 7))
    : new Map();
  for (const line of lines) {
    const result = computePayrollLine({
      ...lineInput(line, periodStart, periodEnd, line),
      contributionSplit,
      firstCutoff: firstCutoffLines.get(Number(line.employee_id)),
    });
    await writeComputedLine(connection, line.id, result);
  }
  await connection.execute("UPDATE payroll_runs SET contribution_split = ? WHERE id = ?", [contributionSplit, run.id]);
  await connection.execute(
    `UPDATE payroll_runs r JOIN (
        SELECT run_id,
               COALESCE(SUM(gross_pay), 0) AS gross, COALESCE(SUM(net_pay), 0) AS net,
               COALESCE(SUM(sss_ee + philhealth_ee + pagibig_ee), 0) AS ee,
               COALESCE(SUM(sss_er + ec_er + philhealth_er + pagibig_er), 0) AS er,
               COALESCE(SUM(withholding_tax), 0) AS tax, COALESCE(SUM(thirteenth_month_accrual), 0) AS thirteenth
          FROM payroll_lines WHERE run_id = ? GROUP BY run_id
      ) t ON t.run_id = r.id
        SET r.total_gross = t.gross, r.total_net = t.net, r.total_employee_contributions = t.ee,
            r.total_employer_contributions = t.er, r.total_withholding_tax = t.tax, r.total_thirteenth_month = t.thirteenth,
            r.rate_table_year = ?
      WHERE r.id = ?`,
    [run.id, getPayrollRates(periodEnd).year, run.id],
  );
  if (!lines.length) {
    await connection.execute(
      `UPDATE payroll_runs SET total_gross = 0, total_net = 0, total_employee_contributions = 0, total_employer_contributions = 0,
              total_withholding_tax = 0, total_thirteenth_month = 0 WHERE id = ?`,
      [run.id],
    );
  }
}

/** Build the lines of a draft run from the staff list (employed at any point in the cut-off). */
async function buildDraftLines(connection, run) {
  const periodStart = formatDbDateOnly(run.period_start);
  const periodEnd = formatDbDateOnly(run.period_end);
  const [employees] = await connection.execute(
    `SELECT * FROM employees
      WHERE start_date <= ? AND (end_date IS NULL OR end_date >= ?)
        AND (status = 'active' OR end_date IS NOT NULL)
      ORDER BY full_name ASC`,
    [periodEnd, periodStart],
  );
  let added = 0;
  for (const employee of employees) {
    const employedTo = employee.end_date ? minDate(formatDbDateOnly(employee.end_date), periodEnd) : periodEnd;
    const rate = await rateOn(connection, employee.id, employedTo);
    if (rate == null) continue;
    const from = minDate(periodEnd, formatDbDateOnly(employee.start_date) > periodStart ? formatDbDateOnly(employee.start_date) : periodStart);
    const scheduledDays = countWorkingDays(from, employedTo, employee.daily_divisor);
    let daysWorked = 0;
    let hoursWorked = 0;
    let otHours = 0;
    let note = null;
    if (employee.user_id && employee.pay_basis !== "monthly") {
      const attendance = await shiftAttendance(connection, employee.user_id, from, employedTo);
      daysWorked = attendance.days;
      hoursWorked = attendance.regularHours;
      otHours = attendance.otHours;
      note = `From ${attendance.shifts} closed POS shift${attendance.shifts === 1 ? "" : "s"} — check and edit`;
    } else if (employee.pay_basis === "daily") {
      daysWorked = scheduledDays;
      note = `Scheduled days (${scheduledDays}) — check and edit`;
    } else if (employee.pay_basis === "hourly") {
      note = "Enter the hours worked";
    }
    await connection.execute(
      `INSERT INTO payroll_lines (run_id, employee_id, employee_name, position, pay_basis, rate, daily_divisor,
                                  days_worked, hours_worked, ot_hours, prefill_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [run.id, employee.id, employee.full_name, employee.position, employee.pay_basis, rate, employee.daily_divisor,
        daysWorked, hoursWorked, otHours, note],
    );
    added += 1;
  }
  return added;
}

async function lockRun(connection, id) {
  const [[run]] = await connection.execute("SELECT * FROM payroll_runs WHERE id = ? FOR UPDATE", [id]);
  if (!run) throw httpError(404, "Payroll run not found.");
  return run;
}

async function reverseEntry(connection, entryId, reason, actor) {
  const [[original]] = await connection.execute("SELECT * FROM journal_entries WHERE id = ? FOR UPDATE", [entryId]);
  if (!original) throw httpError(404, "Journal entry not found.");
  const [[existing]] = await connection.execute("SELECT id FROM journal_entries WHERE reverses_entry_id = ? LIMIT 1", [entryId]);
  if (existing) throw httpError(409, "This entry was already reversed.");
  const [lines] = await connection.execute("SELECT account_id, debit, credit, id FROM journal_entry_lines WHERE journal_entry_id = ?", [entryId]);
  const [header] = await connection.execute(
    `INSERT INTO journal_entries (entry_number, entry_type, memo, session_id, is_reversal, reverses_entry_id, created_by)
     VALUES (?, 'void_reversal', ?, ?, TRUE, ?, ?)`,
    [generateEntryNumber("REV"), `Reversal of ${original.entry_number}: ${reason}`.slice(0, 255), original.session_id, entryId, actor],
  );
  for (const line of lines) {
    await connection.execute(
      "INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo) VALUES (?, ?, ?, ?, ?)",
      [header.insertId, line.account_id, round2(line.credit), round2(line.debit), `Reversing line #${line.id}`],
    );
  }
  return Number(header.insertId);
}

async function assertFunds(connection, accountCode, amount) {
  const [[row]] = await connection.execute(
    `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS balance
       FROM journal_entry_lines jel JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE coa.account_code = ?`,
    [accountCode],
  );
  const balance = round2(row?.balance || 0);
  if (amount > balance + 0.001) {
    throw httpError(409, `Not enough money in that account: paying ${pesoText(amount)} but the balance is ${pesoText(Math.max(0, balance))}.`);
  }
}

const money = (value) => Number(value || 0);
const pesoText = (value) => `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toLine(row) {
  return {
    id: Number(row.id),
    employeeId: Number(row.employee_id),
    employeeName: row.employee_name,
    position: row.position,
    payBasis: row.pay_basis,
    rate: money(row.rate),
    dailyDivisor: Number(row.daily_divisor),
    daysWorked: money(row.days_worked),
    hoursWorked: money(row.hours_worked),
    daysAbsent: money(row.days_absent),
    otHours: money(row.ot_hours),
    prefillNote: row.prefill_note,
    prorationNote: row.proration_note,
    basicPay: money(row.basic_pay),
    otPay: money(row.ot_pay),
    grossPay: money(row.gross_pay),
    sssEe: money(row.sss_ee),
    philhealthEe: money(row.philhealth_ee),
    pagibigEe: money(row.pagibig_ee),
    withholdingTax: money(row.withholding_tax),
    netPay: money(row.net_pay),
    sssEr: money(row.sss_er),
    ecEr: money(row.ec_er),
    philhealthEr: money(row.philhealth_er),
    pagibigEr: money(row.pagibig_er),
    thirteenthMonthAccrual: money(row.thirteenth_month_accrual),
    paidAt: row.paid_at,
    paymentChannel: row.payment_channel,
    thirteenthPaidAt: row.thirteenth_paid_at,
  };
}

function toRun(row) {
  return {
    id: Number(row.id),
    periodStart: formatDbDateOnly(row.period_start),
    periodEnd: formatDbDateOnly(row.period_end),
    payDate: formatDbDateOnly(row.pay_date),
    status: row.status,
    rateTableYear: row.rate_table_year ? Number(row.rate_table_year) : null,
    contributionSplit: row.contribution_split || "per_cutoff",
    totals: {
      gross: money(row.total_gross),
      net: money(row.total_net),
      employeeContributions: money(row.total_employee_contributions),
      employerContributions: money(row.total_employer_contributions),
      withholdingTax: money(row.total_withholding_tax),
      thirteenthMonth: money(row.total_thirteenth_month),
      laborCost: round2(money(row.total_gross) + money(row.total_employer_contributions) + money(row.total_thirteenth_month)),
    },
    headcount: row.headcount != null ? Number(row.headcount) : undefined,
    paidCount: row.paid_count != null ? Number(row.paid_count) : undefined,
    notes: row.notes,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by_name || null,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    accrualJournalEntryId: row.accrual_journal_entry_id ? Number(row.accrual_journal_entry_id) : null,
  };
}

async function loadRun(executor, id) {
  const [[row]] = await executor.execute(
    `SELECT r.*, COALESCE(u.display_name, u.username) AS approved_by_name
       FROM payroll_runs r LEFT JOIN users u ON u.id = r.approved_by WHERE r.id = ?`,
    [id],
  );
  if (!row) throw httpError(404, "Payroll run not found.");
  const [lines] = await executor.execute("SELECT * FROM payroll_lines WHERE run_id = ? ORDER BY employee_name ASC", [id]);
  const [payables] = await executor.execute(
    `SELECT id, bill_number, vendor_name, liability_account_code, original_amount, paid_amount, status, due_date
       FROM financial_payables WHERE payroll_run_id = ? ORDER BY liability_account_code`,
    [id],
  );
  const run = toRun(row);
  run.lines = lines.map(toLine);
  run.payables = payables.map((p) => ({
    id: Number(p.id),
    billNumber: p.bill_number,
    payee: p.vendor_name,
    accountCode: p.liability_account_code,
    amount: money(p.original_amount),
    paid: money(p.paid_amount),
    status: p.status,
    dueDate: formatDbDateOnly(p.due_date),
  }));
  return run;
}

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

router.get("/runs", async (request, response) => {
  const [rows] = await pool.execute(
    `SELECT r.*, COALESCE(u.display_name, u.username) AS approved_by_name,
            (SELECT COUNT(*) FROM payroll_lines pl WHERE pl.run_id = r.id) AS headcount,
            (SELECT COUNT(*) FROM payroll_lines pl WHERE pl.run_id = r.id AND pl.paid_at IS NOT NULL) AS paid_count
       FROM payroll_runs r LEFT JOIN users u ON u.id = r.approved_by
      ORDER BY r.period_start DESC, r.id DESC
      LIMIT 60`,
  );
  const today = getManilaDateString();
  response.json({ items: rows.map(toRun), suggestedCutoff: cutoffFor(today) });
});

router.get("/runs/:id", async (request, response) => {
  response.json({ run: await loadRun(pool, parsePositiveIntId(request.params.id, "Payroll run")) });
});

router.post("/runs", async (request, response) => {
  const anyDate = String(request.body?.periodStart || getManilaDateString());
  if (!isValidIsoDateOnly(anyDate)) throw httpError(400, "Cut-off date must use YYYY-MM-DD format.");
  const { periodStart, periodEnd } = cutoffFor(anyDate);
  if (request.body?.periodEnd && !isStandardCutoff(periodStart, String(request.body.periodEnd))) {
    throw httpError(400, "Payroll runs follow the semi-monthly cut-offs: the 1st–15th or the 16th–end of the month.");
  }
  const payDate = String(request.body?.payDate || periodEnd);
  if (!isValidIsoDateOnly(payDate) || payDate < periodStart) throw httpError(400, "Pay date must be a valid date within or after the cut-off.");
  if (periodStart > getManilaDateString()) throw httpError(400, "That cut-off has not started yet.");
  getPayrollRates(periodEnd);

  const id = await inTransaction(async (connection) => {
    let result;
    try {
      [result] = await connection.execute(
        "INSERT INTO payroll_runs (period_start, period_end, pay_date, created_by) VALUES (?, ?, ?, ?)",
        [periodStart, periodEnd, payDate, request.authUser.sub],
      );
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") throw httpError(409, `There is already a payroll run for ${periodStart} to ${periodEnd}. Open it, or void it first.`);
      throw error;
    }
    const run = { id: result.insertId, period_start: periodStart, period_end: periodEnd };
    const added = await buildDraftLines(connection, run);
    if (!added) throw httpError(400, "No one on the staff list was employed in this cut-off. Add employees first.");
    await recomputeRun(connection, run);
    return result.insertId;
  });
  response.status(201).json({ message: "Draft payroll created. Check days and hours, then approve.", run: await loadRun(pool, id) });
});

// Rebuild a draft from the current staff list and rates (edits to days/hours are reset).
router.post("/runs/:id/rebuild", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Payroll run");
  await inTransaction(async (connection) => {
    const run = await lockRun(connection, id);
    if (run.status !== "draft") throw httpError(409, "Only a draft can be rebuilt.");
    await connection.execute("DELETE FROM payroll_lines WHERE run_id = ?", [id]);
    await buildDraftLines(connection, run);
    await recomputeRun(connection, run);
  });
  response.json({ message: "Draft rebuilt from the current staff list.", run: await loadRun(pool, id) });
});

router.delete("/runs/:id", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Payroll run");
  await inTransaction(async (connection) => {
    const run = await lockRun(connection, id);
    if (run.status !== "draft") throw httpError(409, "Only a draft can be deleted. Void an approved run instead.");
    await connection.execute("DELETE FROM payroll_runs WHERE id = ?", [id]);
  });
  response.json({ message: "Draft deleted." });
});

router.patch("/runs/:id/lines/:lineId", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Payroll run");
  const lineId = parsePositiveIntId(request.params.lineId, "Payroll line");
  const body = request.body || {};
  const updates = {
    days_worked: cleanHours(body.daysWorked, "Days worked", 16),
    hours_worked: cleanHours(body.hoursWorked, "Hours worked", 16 * 24),
    days_absent: cleanHours(body.daysAbsent, "Days absent", 16),
    ot_hours: cleanHours(body.otHours, "Overtime hours", 16 * 16),
  };
  const columns = Object.keys(updates).filter((key) => updates[key] !== undefined);
  if (!columns.length) throw httpError(400, "Nothing to change.");
  await inTransaction(async (connection) => {
    const run = await lockRun(connection, id);
    if (run.status !== "draft") throw httpError(409, "This run is approved. Void it to make changes.");
    const [[line]] = await connection.execute("SELECT id FROM payroll_lines WHERE id = ? AND run_id = ?", [lineId, id]);
    if (!line) throw httpError(404, "Payroll line not found.");
    await connection.execute(
      `UPDATE payroll_lines SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      [...columns.map((column) => updates[column]), lineId],
    );
    await recomputeRun(connection, run);
  });
  response.json({ run: await loadRun(pool, id) });
});

router.delete("/runs/:id/lines/:lineId", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Payroll run");
  const lineId = parsePositiveIntId(request.params.lineId, "Payroll line");
  await inTransaction(async (connection) => {
    const run = await lockRun(connection, id);
    if (run.status !== "draft") throw httpError(409, "This run is approved. Void it to make changes.");
    const [result] = await connection.execute("DELETE FROM payroll_lines WHERE id = ? AND run_id = ?", [lineId, id]);
    if (!result.affectedRows) throw httpError(404, "Payroll line not found.");
    await recomputeRun(connection, run);
  });
  response.json({ message: "Employee removed from this run.", run: await loadRun(pool, id) });
});

router.post("/runs/:id/approve", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Payroll run");
  const actor = request.authUser.sub;
  await inTransaction(async (connection) => {
    const run = await lockRun(connection, id);
    if (run.status !== "draft") throw httpError(409, `This run is already ${run.status}.`);
    const periodStart = formatDbDateOnly(run.period_start);
    const periodEnd = formatDbDateOnly(run.period_end);
    await recomputeRun(connection, run);
    const [lines] = await connection.execute("SELECT * FROM payroll_lines WHERE run_id = ?", [id]);
    if (!lines.length) throw httpError(400, "This run has no employees.");

    const sum = (pick) => round2(lines.reduce((total, line) => total + pick(line), 0));
    const salaries = sum((l) => (l.pay_basis === "monthly" ? money(l.basic_pay) : 0));
    const wages = sum((l) => (l.pay_basis !== "monthly" ? money(l.basic_pay) : 0));
    const overtime = sum((l) => money(l.ot_pay));
    const employer = sum((l) => money(l.sss_er) + money(l.ec_er) + money(l.philhealth_er) + money(l.pagibig_er));
    const employee = sum((l) => money(l.sss_ee) + money(l.philhealth_ee) + money(l.pagibig_ee));
    const thirteenth = sum((l) => money(l.thirteenth_month_accrual));
    const net = sum((l) => money(l.net_pay));
    const tax = sum((l) => money(l.withholding_tax));
    if (round2(salaries + wages + overtime) <= 0) throw httpError(400, "Total pay is zero. Enter days or hours worked before approving.");

    const label = `Payroll ${periodStart} to ${periodEnd}`;
    const today = getManilaDateString();
    const entry = await postBalancedEntry(connection, {
      entryType: "operating_expense",
      memo: `${label} (${lines.length} staff)`,
      referenceNumber: `PAYROLL-${id}`,
      idempotencyKey: `payroll-approve:${id}`,
      entryDate: `${minDate(periodEnd, today)} 12:00:00`,
      createdBy: actor,
      lines: [
        { accountCode: "6111", debit: salaries, credit: 0, lineMemo: "Salaries (monthly-rated)" },
        { accountCode: "6115", debit: wages, credit: 0, lineMemo: "Wages (daily / hourly)" },
        { accountCode: "6116", debit: overtime, credit: 0, lineMemo: "Overtime" },
        { accountCode: "6112", debit: employer, credit: 0, lineMemo: "Employer SSS / EC / PhilHealth / Pag-IBIG" },
        { accountCode: "6114", debit: thirteenth, credit: 0, lineMemo: "13th month accrual" },
        { accountCode: "2040", debit: 0, credit: net, lineMemo: "Net pay owed to staff" },
        { accountCode: "2050", debit: 0, credit: round2(employee + employer), lineMemo: "SSS / PhilHealth / Pag-IBIG to remit" },
        { accountCode: "2060", debit: 0, credit: tax, lineMemo: "Withholding tax to remit" },
        { accountCode: "2045", debit: 0, credit: thirteenth, lineMemo: "13th month owed" },
      ],
    });
    if (entry.skipped) throw httpError(409, "This run was already posted to the ledger.");

    const nextMonth = (day) => {
      const [y, m] = periodEnd.split("-").map(Number);
      return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-${day}`;
    };
    const payables = [
      { code: "2040", category: "payroll", suffix: "NET", payee: "Staff net pay", amount: net, expense: "6111", due: formatDbDateOnly(run.pay_date) },
      { code: "2050", category: "statutory", suffix: "GOV", payee: "SSS / PhilHealth / Pag-IBIG", amount: round2(employee + employer), expense: "6112", due: null },
      { code: "2060", category: "statutory", suffix: "TAX", payee: "BIR — withholding tax on compensation", amount: tax, expense: "6111", due: nextMonth("10") },
    ];
    for (const p of payables) {
      if (p.amount <= 0) continue;
      await connection.execute(
        `INSERT INTO financial_payables (
           bill_number, bill_category, vendor_name, expense_account_code, liability_account_code, bill_date, due_date,
           original_amount, paid_amount, status, incurred_journal_entry_id, payroll_run_id, notes, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.00, 'unpaid', ?, ?, ?, ?)`,
        [`PAY-${id}-${p.suffix}`, p.category, p.payee, p.expense, p.code, minDate(periodEnd, today), p.due, p.amount, entry.entryId, id, label, actor],
      );
    }
    const allZero = lines.every((l) => money(l.net_pay) <= 0);
    await connection.execute(
      "UPDATE payroll_runs SET status = ?, accrual_journal_entry_id = ?, approved_by = ?, approved_at = NOW() WHERE id = ?",
      [allZero ? "paid" : "approved", entry.entryId, actor, id],
    );
  });
  response.json({ message: "Payroll approved and posted. You can now pay your staff.", run: await loadRun(pool, id) });
});

router.post("/runs/:id/pay", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Payroll run");
  const channel = cleanChannel(request.body?.channel);
  const accountCode = CHANNEL_ACCOUNTS[channel];
  const lineIds = Array.isArray(request.body?.lineIds) ? request.body.lineIds.map((v) => parsePositiveIntId(v, "Payroll line")) : null;
  const actor = request.authUser.sub;
  let paidCount = 0;
  await inTransaction(async (connection) => {
    const run = await lockRun(connection, id);
    if (run.status !== "approved") throw httpError(409, run.status === "paid" ? "Everyone in this run is already paid." : "Approve the run before paying.");
    const [[payable]] = await connection.execute(
      "SELECT * FROM financial_payables WHERE payroll_run_id = ? AND liability_account_code = '2040' FOR UPDATE",
      [id],
    );
    const [lines] = await connection.execute(
      `SELECT * FROM payroll_lines WHERE run_id = ? AND paid_at IS NULL ${lineIds ? `AND id IN (${lineIds.map(() => "?").join(",")})` : ""} FOR UPDATE`,
      [id, ...(lineIds || [])],
    );
    if (!lines.length) throw httpError(400, "No unpaid employees selected.");
    const total = round2(lines.reduce((s, l) => s + money(l.net_pay), 0));
    if (total > 0) await assertFunds(connection, accountCode, total);
    const sessionId = accountCode === "1010" ? await resolveActiveSessionId(connection, actor) : null;
    let payablePaid = money(payable?.paid_amount);
    for (const line of lines) {
      const amount = money(line.net_pay);
      let entryId = null;
      if (amount > 0) {
        if (!payable) throw httpError(409, "The net pay payable for this run is missing.");
        const entry = await postBalancedEntry(connection, {
          entryType: "ap_settlement",
          memo: `Pay ${line.employee_name} — payroll ${formatDbDateOnly(run.period_start)} to ${formatDbDateOnly(run.period_end)}`,
          referenceNumber: payable.bill_number,
          sessionId,
          payableId: payable.id,
          createdBy: actor,
          lines: [
            { accountCode: "2040", debit: amount, credit: 0, lineMemo: `Net pay ${line.employee_name}` },
            { accountCode, debit: 0, credit: amount, lineMemo: `Paid by ${CHANNEL_LABELS[channel]}` },
          ],
        });
        if (entry.skipped) throw httpError(409, `${line.employee_name} was already paid.`);
        entryId = entry.entryId;
        payablePaid = round2(payablePaid + amount);
      }
      await connection.execute(
        "UPDATE payroll_lines SET paid_at = NOW(), payment_channel = ?, payment_journal_entry_id = ? WHERE id = ?",
        [channel, entryId, line.id],
      );
      paidCount += 1;
    }
    if (payable) {
      const remaining = round2(money(payable.original_amount) - payablePaid);
      await connection.execute("UPDATE financial_payables SET paid_amount = ?, status = ? WHERE id = ?", [payablePaid, remaining < 0.005 ? "paid" : "partial", payable.id]);
    }
    const [[left]] = await connection.execute("SELECT COUNT(*) AS n FROM payroll_lines WHERE run_id = ? AND paid_at IS NULL", [id]);
    if (Number(left.n) === 0) await connection.execute("UPDATE payroll_runs SET status = 'paid' WHERE id = ?", [id]);
  });
  response.json({ message: `${paidCount} ${paidCount === 1 ? "employee" : "employees"} paid by ${CHANNEL_LABELS[channel]}.`, run: await loadRun(pool, id) });
});

// Undo one employee's payment (reverses the payment entry). Needed before voiding a run.
router.post("/runs/:id/lines/:lineId/unpay", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Payroll run");
  const lineId = parsePositiveIntId(request.params.lineId, "Payroll line");
  const reason = String(request.body?.reason || "Payment undone").trim().slice(0, 160) || "Payment undone";
  await inTransaction(async (connection) => {
    const run = await lockRun(connection, id);
    const [[line]] = await connection.execute("SELECT * FROM payroll_lines WHERE id = ? AND run_id = ? FOR UPDATE", [lineId, id]);
    if (!line) throw httpError(404, "Payroll line not found.");
    if (!line.paid_at) throw httpError(409, "This employee has not been paid yet.");
    if (line.payment_journal_entry_id) {
      await reverseEntry(connection, line.payment_journal_entry_id, reason, request.authUser.sub);
      const [[payable]] = await connection.execute(
        "SELECT * FROM financial_payables WHERE payroll_run_id = ? AND liability_account_code = '2040' FOR UPDATE",
        [id],
      );
      const newPaid = round2(Math.max(0, money(payable.paid_amount) - money(line.net_pay)));
      await connection.execute("UPDATE financial_payables SET paid_amount = ?, status = ? WHERE id = ?", [newPaid, newPaid <= 0 ? "unpaid" : "partial", payable.id]);
    }
    await connection.execute("UPDATE payroll_lines SET paid_at = NULL, payment_channel = NULL, payment_journal_entry_id = NULL WHERE id = ?", [lineId]);
    if (run.status === "paid") await connection.execute("UPDATE payroll_runs SET status = 'approved' WHERE id = ?", [id]);
  });
  response.json({ message: "Payment undone. The money is back in its account.", run: await loadRun(pool, id) });
});

router.post("/runs/:id/void", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Payroll run");
  const reason = String(request.body?.reason || "").trim().slice(0, 255);
  if (!reason) throw httpError(400, "Say why this run is being voided.");
  await inTransaction(async (connection) => {
    const run = await lockRun(connection, id);
    if (run.status === "draft") throw httpError(409, "A draft has nothing posted. Delete it instead.");
    if (run.status === "voided") throw httpError(409, "This run is already voided.");
    const [[paid]] = await connection.execute(
      "SELECT COUNT(*) AS n FROM payroll_lines WHERE run_id = ? AND (paid_at IS NOT NULL AND net_pay > 0 OR thirteenth_paid_at IS NOT NULL)",
      [id],
    );
    if (Number(paid.n) > 0) throw httpError(409, "Some staff in this run were already paid. Undo those payments first.");
    const [payables] = await connection.execute("SELECT * FROM financial_payables WHERE payroll_run_id = ? FOR UPDATE", [id]);
    if (payables.some((p) => money(p.paid_amount) > 0)) {
      throw httpError(409, "Contributions or tax from this run were already remitted. Reverse that remittance in Payables first.");
    }
    const reversalId = await reverseEntry(connection, run.accrual_journal_entry_id, `Payroll run voided: ${reason}`, request.authUser.sub);
    await connection.execute("UPDATE financial_payables SET status = 'voided' WHERE payroll_run_id = ?", [id]);
    await connection.execute("UPDATE payroll_lines SET paid_at = NULL, payment_channel = NULL WHERE run_id = ?", [id]);
    await connection.execute(
      "UPDATE payroll_runs SET status = 'voided', void_journal_entry_id = ?, voided_by = ?, voided_at = NOW(), void_reason = ? WHERE id = ?",
      [reversalId, request.authUser.sub, reason, id],
    );
  });
  response.json({ message: "Payroll run voided. Its ledger entry was reversed, nothing was deleted.", run: await loadRun(pool, id) });
});

// ---------------------------------------------------------------------------------------------
// 13th month
// ---------------------------------------------------------------------------------------------

function cleanYear(value) {
  const year = Number(value || getManilaDateString().slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw httpError(400, "Choose a valid year.");
  return year;
}

router.get("/thirteenth-month", async (request, response) => {
  const year = cleanYear(request.query?.year);
  const [rows] = await pool.execute(
    `SELECT e.id, e.full_name, e.status, e.end_date,
            COALESCE(SUM(pl.thirteenth_month_accrual), 0) AS accrued,
            COALESCE(SUM(CASE WHEN pl.thirteenth_paid_at IS NOT NULL THEN pl.thirteenth_month_accrual ELSE 0 END), 0) AS paid,
            COALESCE(SUM(pl.basic_pay), 0) AS basic
       FROM payroll_lines pl
       JOIN payroll_runs r ON r.id = pl.run_id
       JOIN employees e ON e.id = pl.employee_id
      WHERE r.status IN ('approved', 'paid') AND YEAR(r.period_end) = ?
      GROUP BY e.id, e.full_name, e.status, e.end_date
      ORDER BY e.full_name`,
    [year],
  );
  response.json({
    year,
    dueBy: `${year}-12-24`,
    items: rows.map((row) => ({
      employeeId: Number(row.id),
      employeeName: row.full_name,
      status: row.status,
      endDate: formatDbDateOnly(row.end_date),
      basicPayEarned: money(row.basic),
      accrued: money(row.accrued),
      paid: money(row.paid),
      unpaid: round2(money(row.accrued) - money(row.paid)),
    })),
  });
});

router.post("/thirteenth-month/pay", async (request, response) => {
  const year = cleanYear(request.body?.year);
  const employeeId = parsePositiveIntId(request.body?.employeeId, "Employee");
  const channel = cleanChannel(request.body?.channel);
  const accountCode = CHANNEL_ACCOUNTS[channel];
  const actor = request.authUser.sub;
  let amount = 0;
  let name = "";
  await inTransaction(async (connection) => {
    const [lines] = await connection.execute(
      `SELECT pl.id, pl.thirteenth_month_accrual, pl.employee_name
         FROM payroll_lines pl JOIN payroll_runs r ON r.id = pl.run_id
        WHERE pl.employee_id = ? AND r.status IN ('approved', 'paid') AND YEAR(r.period_end) = ?
          AND pl.thirteenth_paid_at IS NULL AND pl.thirteenth_month_accrual > 0
        FOR UPDATE`,
      [employeeId, year],
    );
    if (!lines.length) throw httpError(400, "Nothing to pay: there is no unpaid 13th month for this employee and year.");
    amount = round2(lines.reduce((s, l) => s + money(l.thirteenth_month_accrual), 0));
    name = lines[0].employee_name;
    await assertFunds(connection, accountCode, amount);
    const sessionId = accountCode === "1010" ? await resolveActiveSessionId(connection, actor) : null;
    const entry = await postBalancedEntry(connection, {
      entryType: "ap_settlement",
      memo: `13th month pay ${year} — ${name}`,
      referenceNumber: `13TH-${year}-${employeeId}`,
      sessionId,
      createdBy: actor,
      lines: [
        { accountCode: "2045", debit: amount, credit: 0, lineMemo: `13th month ${year} ${name}` },
        { accountCode, debit: 0, credit: amount, lineMemo: `Paid by ${CHANNEL_LABELS[channel]}` },
      ],
    });
    await connection.execute(
      `UPDATE payroll_lines SET thirteenth_paid_at = NOW(), thirteenth_payment_journal_entry_id = ?
        WHERE id IN (${lines.map(() => "?").join(",")})`,
      [entry.entryId, ...lines.map((l) => l.id)],
    );
  });
  response.json({ message: `13th month of ${pesoText(amount)} paid to ${name}.`, amount });
});

router.post("/thirteenth-month/undo", async (request, response) => {
  const year = cleanYear(request.body?.year);
  const employeeId = parsePositiveIntId(request.body?.employeeId, "Employee");
  await inTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT DISTINCT pl.thirteenth_payment_journal_entry_id AS je
         FROM payroll_lines pl JOIN payroll_runs r ON r.id = pl.run_id
        WHERE pl.employee_id = ? AND YEAR(r.period_end) = ? AND pl.thirteenth_payment_journal_entry_id IS NOT NULL
        FOR UPDATE`,
      [employeeId, year],
    );
    if (!rows.length) throw httpError(400, "No 13th month payment to undo.");
    for (const row of rows) await reverseEntry(connection, row.je, "13th month payment undone", request.authUser.sub);
    await connection.execute(
      `UPDATE payroll_lines pl JOIN payroll_runs r ON r.id = pl.run_id
          SET pl.thirteenth_paid_at = NULL, pl.thirteenth_payment_journal_entry_id = NULL
        WHERE pl.employee_id = ? AND YEAR(r.period_end) = ?`,
      [employeeId, year],
    );
  });
  response.json({ message: "13th month payment undone." });
});

// ---------------------------------------------------------------------------------------------
// Owner's pay (drawings). Not payroll and not an expense: it lowers equity and cash only.
// Recording one goes through POST /finances/journal-entries (entryType owner_withdrawal).
// ---------------------------------------------------------------------------------------------

router.get("/owner-pay", async (request, response) => {
  const year = cleanYear(request.query?.year);
  const [rows] = await pool.execute(
    `SELECT je.id, je.entry_date, je.memo, COALESCE(SUM(jel.debit), 0) AS amount,
            MAX(CASE WHEN jel.credit > 0 THEN coa.account_code END) AS paid_from
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.entry_type = 'owner_withdrawal' AND je.is_reversal = FALSE
        AND YEAR(je.entry_date) = ?
        AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reverses_entry_id = je.id)
      GROUP BY je.id, je.entry_date, je.memo
      ORDER BY je.entry_date DESC, je.id DESC`,
    [year],
  );
  const items = rows.map((row) => ({
    id: Number(row.id),
    date: formatDbDateOnly(row.entry_date),
    memo: row.memo,
    amount: money(row.amount),
    paidFrom: row.paid_from,
  }));
  response.json({ year, total: round2(items.reduce((s, i) => s + i.amount, 0)), items });
});

export default router;
