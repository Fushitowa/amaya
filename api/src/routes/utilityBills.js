import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import {
  assertPeriodOpen,
  generateEntryNumber,
  getManilaDateString,
  isValidIsoDateOnly,
  parseExactMoney,
  postBalancedEntry,
  resolveActiveSessionId,
  round2,
} from "../utils/ledgerService.js";
import { parsePositiveIntId } from "../utils/validation.js";
import { formatDbDateOnly } from "../../../shared/manilaDate.js";
import { getExpenseNavCategory, getUtilityCategories } from "../../../shared/expenseNavigation.js";
import {
  MAX_SERVICE_DAYS,
  daysBetweenInclusive,
  estimateUncoveredMonth,
  monthBounds,
  shiftMonth,
  splitServicePeriod,
} from "../../../shared/utilityBills.js";
import { getProfitAndLossReport } from "../services/financesReportService.js";

/**
 * Utility bills (payroll plan Phase 3B): O3.4 bill form, O3.5 late-bill estimates, O3.6 LPG tank
 * log, O3.9 utility insight. Mounted at /api/finances/utility-bills (admin only).
 *
 * Ledger, per bill:
 *   Each month part   (operating_expense)  Dr 6131/6132/6133/6135  Cr 2010   dated in its month
 *   Paid now          (ap_settlement)      Dr 2010  Cr 1010/1020/1030       dated today
 * One AP payable (2010) carries the whole bill with its due date; unpaid bills are settled later
 * from Finances → Payables like any supplier bill.
 */
const router = Router();
router.use(requireAuth, requireRole("admin"));

const CHANNEL_ACCOUNTS = { cash_counter: "1010", gcash: "1020", store_bank: "1030" };

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

function utilityCategory(slug) {
  const category = getExpenseNavCategory(String(slug || ""));
  if (!category?.utility) {
    throw httpError(400, `Choose a utility: ${getUtilityCategories().map((c) => c.label).join(", ")}.`);
  }
  return category;
}

function cleanMonth(value) {
  const month = String(value || getManilaDateString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw httpError(400, "Month must use YYYY-MM format.");
  return month;
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function toBill(row, parts = []) {
  return {
    id: Number(row.id),
    utility: row.utility_slug,
    expenseAccountCode: row.expense_account_code,
    provider: row.provider,
    accountNumber: row.account_number,
    serviceFrom: formatDbDateOnly(row.service_from),
    serviceTo: formatDbDateOnly(row.service_to),
    serviceDays: daysBetweenInclusive(formatDbDateOnly(row.service_from), formatDbDateOnly(row.service_to)),
    reading: row.reading_value == null ? null : Number(row.reading_value),
    readingUnit: row.reading_unit,
    amount: Number(row.amount),
    dueDate: row.due_date ? formatDbDateOnly(row.due_date) : null,
    status: row.status,
    payableId: row.payable_id == null ? null : Number(row.payable_id),
    payableStatus: row.payable_status || null,
    paidAmount: row.paid_amount == null ? 0 : Number(row.paid_amount),
    notes: row.notes,
    createdAt: row.created_at,
    parts: parts.map((part) => ({
      month: formatDbDateOnly(part.part_month).slice(0, 7),
      from: formatDbDateOnly(part.part_from),
      to: formatDbDateOnly(part.part_to),
      days: Number(part.days),
      amount: Number(part.amount),
      readingShare: part.reading_share == null ? null : Number(part.reading_share),
      journalEntryId: Number(part.journal_entry_id),
    })),
  };
}

async function loadBills(executor, { utility = null, id = null, limit = 50 } = {}) {
  const conditions = [];
  const params = [];
  if (utility) {
    conditions.push("ub.utility_slug = ?");
    params.push(utility);
  }
  if (id) {
    conditions.push("ub.id = ?");
    params.push(id);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await executor.query(
    `SELECT ub.*, fp.status AS payable_status, fp.paid_amount
       FROM utility_bills ub
       LEFT JOIN financial_payables fp ON fp.id = ub.payable_id
       ${where}
      ORDER BY ub.service_to DESC, ub.id DESC
      LIMIT ${Number(limit)}`,
    params,
  );
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [parts] = await executor.query(
    `SELECT * FROM utility_bill_parts WHERE bill_id IN (${ids.map(() => "?").join(",")}) ORDER BY part_month ASC`,
    ids,
  );
  return rows.map((row) => toBill(row, parts.filter((part) => Number(part.bill_id) === Number(row.id))));
}

async function reverseEntry(connection, entryId, reason, actor) {
  const [[original]] = await connection.execute("SELECT * FROM journal_entries WHERE id = ? FOR UPDATE", [entryId]);
  if (!original) throw httpError(404, "Journal entry not found.");
  const [[existing]] = await connection.execute("SELECT id FROM journal_entries WHERE reverses_entry_id = ? LIMIT 1", [entryId]);
  if (existing) return Number(existing.id);
  const [lines] = await connection.execute("SELECT account_id, debit, credit, id FROM journal_entry_lines WHERE journal_entry_id = ?", [entryId]);
  // Dated like the original, so voiding an October bill takes the cost out of October. A closed
  // month blocks it: reopen the month first.
  await assertPeriodOpen(connection, original.entry_date);
  const [header] = await connection.execute(
    `INSERT INTO journal_entries (entry_number, entry_type, memo, session_id, payable_id, is_reversal, reverses_entry_id, created_by, entry_date)
     VALUES (?, 'void_reversal', ?, ?, ?, TRUE, ?, ?, ?)`,
    [generateEntryNumber("REV"), `Reversal of ${original.entry_number}: ${reason}`.slice(0, 255), original.session_id, original.payable_id, entryId, actor, original.entry_date],
  );
  for (const line of lines) {
    await connection.execute(
      "INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo) VALUES (?, ?, ?, ?, ?)",
      [header.insertId, line.account_id, round2(line.credit), round2(line.debit), `Reversing line #${line.id}`],
    );
  }
  return Number(header.insertId);
}

// ---------------------------------------------------------------------------------------------
// Late-bill estimates (O3.5): shown, never posted (D7)
// ---------------------------------------------------------------------------------------------

/**
 * For each utility with a bill last month or this month, the days of `month` no bill covers yet,
 * estimated at the latest bill's daily cost. Months after the current one are skipped.
 */
export async function loadUtilityEstimates(month, executor = pool) {
  if (month > getManilaDateString().slice(0, 7)) return [];
  const { start, end } = monthBounds(month);
  const previousStart = monthBounds(shiftMonth(month, -1)).start;
  const estimates = [];
  for (const category of getUtilityCategories()) {
    const [[lastBill]] = await executor.execute(
      `SELECT service_from, service_to, amount FROM utility_bills
        WHERE utility_slug = ? AND status = 'active' AND service_to >= ? AND service_from <= ?
        ORDER BY service_to DESC, id DESC LIMIT 1`,
      [category.slug, previousStart, end],
    );
    if (!lastBill) continue;
    const [[covered]] = await executor.execute(
      `SELECT COALESCE(SUM(p.days), 0) AS days FROM utility_bill_parts p JOIN utility_bills b ON b.id = p.bill_id
        WHERE b.utility_slug = ? AND b.status = 'active' AND p.part_month = ?`,
      [category.slug, start],
    );
    const estimate = estimateUncoveredMonth(
      { serviceFrom: formatDbDateOnly(lastBill.service_from), serviceTo: formatDbDateOnly(lastBill.service_to), amount: Number(lastBill.amount) },
      month,
      Number(covered?.days || 0),
    );
    if (estimate) estimates.push({ utility: category.slug, label: category.label, posted: false, ...estimate });
  }
  return estimates;
}

/** Estimates for every month of a P&L range (at most 12, none after the current month). */
export async function loadUtilityEstimatesForRange(from, to) {
  const today = getManilaDateString();
  const lastMonth = (to && to < today ? to : today).slice(0, 7);
  const firstMonth = from ? from.slice(0, 7) : lastMonth;
  const months = [];
  for (let month = lastMonth; month >= firstMonth && months.length < 12; month = shiftMonth(month, -1)) months.push(month);
  const all = [];
  for (const month of months.reverse()) all.push(...(await loadUtilityEstimates(month)));
  return all;
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

router.get("/", async (request, response) => {
  const utility = request.query?.utility ? utilityCategory(request.query.utility).slug : null;
  const limit = Math.min(200, Math.max(1, Number.parseInt(request.query?.limit, 10) || 50));
  response.json({ items: await loadBills(pool, { utility, limit }) });
});

router.get("/estimates", async (request, response) => {
  const month = cleanMonth(request.query?.month);
  response.json({ month, posted: false, items: await loadUtilityEstimates(month) });
});

router.post("/", async (request, response) => {
  const body = request.body || {};
  const category = utilityCategory(body.utility);
  const provider = cleanText(body.provider, 120);
  if (!provider) throw httpError(400, "Who is the bill from? Enter the provider (e.g. Meralco).");
  const accountNumber = cleanText(body.accountNumber, 60) || null;
  const serviceFrom = String(body.serviceFrom || "");
  const serviceTo = String(body.serviceTo || "");
  if (!isValidIsoDateOnly(serviceFrom) || !isValidIsoDateOnly(serviceTo)) {
    throw httpError(400, "Enter the service period printed on the bill (from and to dates).");
  }
  if (serviceFrom > serviceTo) throw httpError(400, "The service period must start on or before the day it ends.");
  if (daysBetweenInclusive(serviceFrom, serviceTo) > MAX_SERVICE_DAYS) {
    throw httpError(400, `One bill can cover at most ${MAX_SERVICE_DAYS} days. Enter longer periods as separate bills.`);
  }
  const today = getManilaDateString();
  if (serviceFrom > today) throw httpError(400, "The service period has not started yet.");
  const amount = parseExactMoney(body.amount, "Bill amount");
  let reading = null;
  if (body.reading !== undefined && body.reading !== null && String(body.reading).trim() !== "") {
    reading = Number(body.reading);
    if (!Number.isFinite(reading) || reading < 0 || reading > 10_000_000) throw httpError(400, "The meter reading (usage) must be zero or more.");
    if (!category.utility.unit) throw httpError(400, `${category.label} bills have no meter reading.`);
  }
  const dueDate = body.dueDate ? String(body.dueDate) : null;
  if (dueDate && !isValidIsoDateOnly(dueDate)) throw httpError(400, "Due date must use YYYY-MM-DD format.");
  const paidNow = Boolean(body.paidNow);
  const channel = String(body.channel || "");
  if (paidNow && !CHANNEL_ACCOUNTS[channel]) throw httpError(400, "Choose how you paid: cash drawer, GCash or bank.");
  const notes = cleanText(body.notes, 255) || null;
  const expenseAccountCode = category.accountCodes[0];

  const [[overlap]] = await pool.execute(
    `SELECT id FROM utility_bills WHERE utility_slug = ? AND status = 'active' AND service_from <= ? AND service_to >= ?
       AND COALESCE(account_number, '') = ? LIMIT 1`,
    [category.slug, serviceTo, serviceFrom, accountNumber || ""],
  );
  if (overlap) {
    throw httpError(409, `There is already a ${category.label.toLowerCase()} bill for part of this period (bill #${overlap.id}). Void it first if it was wrong.`);
  }

  const parts = splitServicePeriod(serviceFrom, serviceTo, amount, reading);
  const billId = await inTransaction(async (connection) => {
    const [billResult] = await connection.execute(
      `INSERT INTO utility_bills (utility_slug, expense_account_code, provider, account_number, service_from, service_to,
                                  reading_value, reading_unit, amount, due_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [category.slug, expenseAccountCode, provider, accountNumber, serviceFrom, serviceTo,
        reading, reading == null ? null : category.utility.unit, amount, dueDate, notes, request.authUser.sub],
    );
    const id = Number(billResult.insertId);
    const label = `${category.label} bill ${serviceFrom} to ${serviceTo} (${provider})`;
    let firstEntryId = null;
    for (const part of parts) {
      if (!(part.amount > 0)) continue;
      const posted = await postBalancedEntry(connection, {
        entryType: "operating_expense",
        memo: `${label}: ${part.days} day${part.days === 1 ? "" : "s"} in ${part.month}`,
        referenceNumber: `UTIL-${id}`,
        entryDate: `${part.partTo} 12:00:00`,
        idempotencyKey: `utility_bill:${id}:${part.month}`,
        createdBy: request.authUser.sub,
        lines: [
          { accountCode: expenseAccountCode, debit: part.amount, credit: 0, lineMemo: `${category.label} used ${part.partFrom} to ${part.partTo}` },
          { accountCode: "2010", debit: 0, credit: part.amount, lineMemo: `Owed to ${provider}` },
        ],
      });
      await connection.execute(
        `UPDATE journal_entries je JOIN expense_categories ec ON ec.slug = ? SET je.expense_category_id = ec.id WHERE je.id = ?`,
        [category.slug, posted.entryId],
      );
      await connection.execute(
        `INSERT INTO utility_bill_parts (bill_id, part_month, part_from, part_to, days, amount, reading_share, journal_entry_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, `${part.month}-01`, part.partFrom, part.partTo, part.days, part.amount, part.readingShare, posted.entryId],
      );
      firstEntryId ??= posted.entryId;
    }
    const [payableResult] = await connection.execute(
      `INSERT INTO financial_payables (bill_number, bill_category, vendor_name, expense_account_code, liability_account_code,
                                       bill_date, due_date, original_amount, paid_amount, status, incurred_journal_entry_id,
                                       notes, created_by)
       VALUES (?, 'opex', ?, ?, '2010', ?, ?, ?, 0.00, 'unpaid', ?, ?, ?)`,
      [`UTIL-${id}`, provider, expenseAccountCode, serviceTo, dueDate, amount, firstEntryId, label.slice(0, 500), request.authUser.sub],
    );
    const payableId = Number(payableResult.insertId);
    await connection.execute("UPDATE utility_bills SET payable_id = ? WHERE id = ?", [payableId, id]);

    if (paidNow) {
      const paymentAccount = CHANNEL_ACCOUNTS[channel];
      // Cash-drawer payments ride on the payer's open shift so shift close expects less cash.
      const sessionId = paymentAccount === "1010" ? await resolveActiveSessionId(connection, request.authUser.sub) : null;
      await postBalancedEntry(connection, {
        entryType: "ap_settlement",
        memo: `Paid ${label}`,
        referenceNumber: `UTIL-${id}`,
        sessionId,
        payableId,
        idempotencyKey: `utility_bill:${id}:paid`,
        createdBy: request.authUser.sub,
        lines: [
          { accountCode: "2010", debit: amount, credit: 0, lineMemo: `Settle UTIL-${id}` },
          { accountCode: paymentAccount, debit: 0, credit: amount, lineMemo: `Paid ${provider}` },
        ],
      });
      await connection.execute("UPDATE financial_payables SET paid_amount = original_amount, status = 'paid' WHERE id = ?", [payableId]);
    }
    return id;
  });

  const [bill] = await loadBills(pool, { id: billId, limit: 1 });
  response.status(201).json({
    message: paidNow
      ? "Bill recorded and paid. Its cost is placed in the month(s) it was used."
      : "Bill recorded. It waits in Payables until you pay it; its cost is placed in the month(s) it was used.",
    bill,
  });
});

router.post("/:id/void", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Utility bill");
  const reason = cleanText(request.body?.reason, 200) || "Wrong bill details";
  await inTransaction(async (connection) => {
    const [[bill]] = await connection.execute("SELECT * FROM utility_bills WHERE id = ? FOR UPDATE", [id]);
    if (!bill) throw httpError(404, "Utility bill not found.");
    if (bill.status === "voided") throw httpError(409, "This bill is already voided.");
    if (bill.payable_id) {
      const [[payable]] = await connection.execute("SELECT * FROM financial_payables WHERE id = ? FOR UPDATE", [bill.payable_id]);
      // Undo every live payment of the bill first, then the bill itself.
      const [settlements] = await connection.execute(
        `SELECT je.id FROM journal_entries je
          WHERE je.payable_id = ? AND je.entry_type = 'ap_settlement' AND je.is_reversal = FALSE
            AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reverses_entry_id = je.id)`,
        [bill.payable_id],
      );
      for (const settlement of settlements) {
        await reverseEntry(connection, settlement.id, `Void utility bill #${id}: ${reason}`, request.authUser.sub);
      }
      if (payable) await connection.execute("UPDATE financial_payables SET paid_amount = 0.00, status = 'voided' WHERE id = ?", [payable.id]);
    }
    const [parts] = await connection.execute("SELECT journal_entry_id FROM utility_bill_parts WHERE bill_id = ?", [id]);
    for (const part of parts) {
      await reverseEntry(connection, part.journal_entry_id, `Void utility bill #${id}: ${reason}`, request.authUser.sub);
    }
    await connection.execute(
      "UPDATE utility_bills SET status = 'voided', voided_by = ?, voided_at = NOW() WHERE id = ?",
      [request.authUser.sub, id],
    );
  });
  const [bill] = await loadBills(pool, { id, limit: 1 });
  response.json({ message: "Bill voided. Its cost and any payment were reversed.", bill });
});

// O3.9 — this month vs last month vs the same month last year, cost per unit, usage per ₱1,000 sales.
router.get("/insights", async (request, response) => {
  const category = utilityCategory(request.query?.utility);
  const month = cleanMonth(request.query?.month);
  const months = { thisMonth: month, lastMonth: shiftMonth(month, -1), lastYear: shiftMonth(month, -12) };
  const result = { utility: category.slug, label: category.label, unit: category.utility.unit, month };
  for (const [key, value] of Object.entries(months)) {
    const { start, end } = monthBounds(value);
    const [[spent]] = await pool.execute(
      `SELECT COALESCE(SUM(jel.debit), 0) AS spent
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.entry_type = 'operating_expense' AND je.is_reversal = FALSE
          AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reverses_entry_id = je.id)
          AND coa.account_code IN (${category.accountCodes.map(() => "?").join(",")})
          AND je.entry_date >= ? AND je.entry_date <= ?`,
      [...category.accountCodes, `${start} 00:00:00`, `${end} 23:59:59`],
    );
    const [[usage]] = await pool.execute(
      `SELECT COALESCE(SUM(p.reading_share), 0) AS usage_total,
              COALESCE(SUM(CASE WHEN p.reading_share IS NOT NULL THEN p.amount ELSE 0 END), 0) AS metered_amount
         FROM utility_bill_parts p JOIN utility_bills b ON b.id = p.bill_id
        WHERE b.utility_slug = ? AND b.status = 'active' AND p.part_month = ?`,
      [category.slug, start],
    );
    const usageTotal = Number(usage?.usage_total || 0);
    result[key] = {
      month: value,
      spent: round2(spent?.spent || 0),
      usage: usageTotal > 0 ? Number(usageTotal.toFixed(3)) : null,
      costPerUnit: usageTotal > 0 ? round2(Number(usage.metered_amount) / usageTotal) : null,
    };
  }
  const changePercent = (current, previous) => (previous > 0 ? round2(((current - previous) / previous) * 100) : null);
  result.vsLastMonthPercent = changePercent(result.thisMonth.spent, result.lastMonth.spent);
  result.vsLastYearPercent = changePercent(result.thisMonth.spent, result.lastYear.spent);
  if (category.slug === "electricity" && result.thisMonth.usage != null) {
    const { start, end } = monthBounds(month);
    const pnl = await getProfitAndLossReport(start, end);
    result.netSales = pnl.netSales;
    result.usagePerThousandSales = pnl.netSales > 0 ? round2((result.thisMonth.usage / pnl.netSales) * 1000) : null;
  }
  response.json(result);
});

// O3.6 — LPG tanks taken from inventory as internal store use (6133): swap dates, days per tank,
// cost per day.
router.get("/lpg-tanks", async (_request, response) => {
  const [rows] = await pool.execute(
    `SELECT m.id, m.created_at, m.item_name_snapshot, ABS(m.quantity_change) AS quantity, m.unit,
            COALESCE(SUM(jel.debit), 0) AS cost
       FROM inventory_movements m
       JOIN journal_entries je ON je.inventory_movement_id = m.id AND je.is_reversal = FALSE
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_code = '6133'
      WHERE m.movement_type = 'internal_use'
        AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reverses_entry_id = je.id)
      GROUP BY m.id, m.created_at, m.item_name_snapshot, m.quantity_change, m.unit
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 500`,
  );
  const today = getManilaDateString();
  const swaps = rows.map((row, index) => {
    const swapDate = getManilaDateString(new Date(row.created_at));
    const next = rows[index + 1];
    const until = next ? getManilaDateString(new Date(next.created_at)) : null;
    const daysLasted = until ? Math.max(1, daysBetweenInclusive(swapDate, until) - 1) : null;
    const cost = round2(row.cost);
    return {
      movementId: Number(row.id),
      swapDate,
      item: row.item_name_snapshot,
      quantity: Number(row.quantity),
      unit: row.unit,
      cost,
      daysLasted,
      inUseFor: until ? null : Math.max(0, daysBetweenInclusive(swapDate, today) - 1),
      costPerDay: daysLasted ? round2(cost / daysLasted) : null,
    };
  });
  const finished = swaps.filter((swap) => swap.daysLasted);
  response.json({
    items: swaps.reverse(),
    averageDaysPerTank: finished.length ? round2(finished.reduce((sum, swap) => sum + swap.daysLasted, 0) / finished.length) : null,
    averageCostPerDay: finished.length
      ? round2(finished.reduce((sum, swap) => sum + swap.cost, 0) / finished.reduce((sum, swap) => sum + swap.daysLasted, 0))
      : null,
  });
});

export default router;
