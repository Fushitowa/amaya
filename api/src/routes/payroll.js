import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { getManilaDateString, isValidIsoDateOnly, parseExactMoney } from "../utils/ledgerService.js";
import { parsePositiveIntId } from "../utils/validation.js";
import { encryptField, maskField } from "../utils/fieldCrypto.js";
import { formatDbDateOnly } from "../../../shared/manilaDate.js";
import { hasValidNetIncomeAccess } from "./finances.js";
import payrollRunRoutes from "./payrollRuns.js";

/**
 * Payroll — Phase 1: the employee master file (Staff list) and pay-rate history.
 * Owner/admin only. Pay rates are profit-revealing, so they are hidden unless the Net Income PIN
 * is unlocked (X-Net-Income-Token). Government ID numbers are encrypted at rest and only ever
 * returned masked.
 */
const router = Router();
router.use(requireAuth, requireRole("admin"));

const EMPLOYMENT_STATUSES = ["regular", "probationary", "part_time", "contractual"];
const PAY_BASES = ["monthly", "daily", "hourly"];
const DAILY_DIVISORS = [261, 313, 365];
const MAX_RATE = { monthly: 1_000_000, daily: 50_000, hourly: 10_000 };

// Digits only. SSS 10, PhilHealth 12, Pag-IBIG 12, TIN 9 or 12 (with branch code).
const GOVERNMENT_IDS = {
  sss: { column: "sss_no", label: "SSS number", lengths: [10] },
  philhealth: { column: "philhealth_no", label: "PhilHealth number", lengths: [12] },
  pagibig: { column: "pagibig_no", label: "Pag-IBIG MID number", lengths: [12] },
  tin: { column: "tin", label: "TIN", lengths: [9, 12] },
};

function cleanText(value, label, maxLength, { required = true } = {}) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) {
    if (required) throw httpError(400, `${label} is required.`);
    return null;
  }
  if (text.length > maxLength) throw httpError(400, `${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function cleanEnum(value, allowed, label) {
  const text = String(value ?? "").trim();
  if (!allowed.includes(text)) throw httpError(400, `${label} must be one of: ${allowed.join(", ")}.`);
  return text;
}

function cleanDate(value, label) {
  const text = String(value ?? "").trim();
  if (!isValidIsoDateOnly(text)) throw httpError(400, `${label} must use YYYY-MM-DD format.`);
  return text;
}

function cleanDivisor(value) {
  const num = Number(value);
  if (!DAILY_DIVISORS.includes(num)) {
    throw httpError(400, "Paid days per year must be 313 (6-day week), 261 (5-day week) or 365 (paid every day).");
  }
  return num;
}

function cleanRate(value, payBasis) {
  const rate = parseExactMoney(value, "Pay rate");
  if (rate > MAX_RATE[payBasis]) {
    throw httpError(400, `A ${payBasis} rate above ₱${MAX_RATE[payBasis].toLocaleString("en-PH")} looks like a typo. Check the amount and pay basis.`);
  }
  return rate;
}

/** undefined = leave unchanged, null = clear, otherwise the encrypted digits. */
function cleanGovernmentId(value, spec) {
  if (value === undefined) return undefined;
  const digits = String(value ?? "").replace(/[\s-]/g, "");
  if (!digits) return null;
  if (!/^\d+$/.test(digits) || !spec.lengths.includes(digits.length)) {
    throw httpError(400, `${spec.label} must have ${spec.lengths.join(" or ")} digits.`);
  }
  return encryptField(digits);
}

async function cleanLinkedUser(connection, value, employeeId = null) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const userId = parsePositiveIntId(value, "Linked login");
  const [[user]] = await connection.execute("SELECT id, role, is_active FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!user || !user.is_active) throw httpError(400, "That POS login does not exist or is disabled.");
  if (user.role !== "staff") {
    throw httpError(400, "Only staff logins can be linked. The owner is never on payroll; owner pay is recorded as Owner's Drawings.");
  }
  const [[taken]] = await connection.execute(
    "SELECT id, full_name FROM employees WHERE user_id = ? AND id <> ? LIMIT 1",
    [userId, employeeId ?? 0],
  );
  if (taken) throw httpError(409, `That login is already linked to ${taken.full_name}.`);
  return userId;
}

const EMPLOYEE_SELECT = `
  SELECT e.*,
         COALESCE(u.display_name, u.username) AS linked_user_name,
         cur.rate AS current_rate, cur.effective_from AS current_rate_from
    FROM employees e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN employee_pay_rates cur ON cur.id = COALESCE(
      (SELECT r.id FROM employee_pay_rates r
        WHERE r.employee_id = e.id AND r.effective_from <= ?
        ORDER BY r.effective_from DESC, r.id DESC LIMIT 1),
      (SELECT r.id FROM employee_pay_rates r
        WHERE r.employee_id = e.id
        ORDER BY r.effective_from ASC, r.id DESC LIMIT 1)
    )`;

function toEmployee(row, ratesUnlocked) {
  return {
    id: Number(row.id),
    fullName: row.full_name,
    position: row.position,
    employmentStatus: row.employment_status,
    payBasis: row.pay_basis,
    dailyDivisor: Number(row.daily_divisor),
    startDate: formatDbDateOnly(row.start_date),
    endDate: formatDbDateOnly(row.end_date),
    status: row.status,
    isArchived: Boolean(row.is_archived),
    linkedUser: row.user_id ? { id: Number(row.user_id), name: row.linked_user_name } : null,
    governmentIds: Object.fromEntries(
      Object.entries(GOVERNMENT_IDS).map(([key, spec]) => [key, maskField(row[spec.column])]),
    ),
    ratesLocked: !ratesUnlocked,
    currentRate: ratesUnlocked && row.current_rate != null ? Number(row.current_rate) : null,
    currentRateFrom: ratesUnlocked ? formatDbDateOnly(row.current_rate_from) : null,
  };
}

async function loadEmployee(connection, id, ratesUnlocked) {
  const [[row]] = await connection.execute(`${EMPLOYEE_SELECT} WHERE e.id = ? LIMIT 1`, [getManilaDateString(), id]);
  if (!row) throw httpError(404, "Employee not found.");
  const employee = toEmployee(row, ratesUnlocked);
  if (ratesUnlocked) {
    const [history] = await connection.execute(
      `SELECT r.id, r.rate, r.effective_from, r.note, r.created_at, COALESCE(u.display_name, u.username) AS set_by_name
         FROM employee_pay_rates r
         LEFT JOIN users u ON u.id = r.set_by
        WHERE r.employee_id = ?
        ORDER BY r.effective_from DESC, r.id DESC`,
      [id],
    );
    employee.rateHistory = history.map((r) => ({
      id: Number(r.id),
      rate: Number(r.rate),
      effectiveFrom: formatDbDateOnly(r.effective_from),
      note: r.note,
      setBy: r.set_by_name,
      createdAt: r.created_at,
    }));
  } else {
    employee.rateHistory = null;
  }
  return employee;
}

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

async function lockEmployee(connection, id) {
  const [[row]] = await connection.execute("SELECT * FROM employees WHERE id = ? FOR UPDATE", [id]);
  if (!row) throw httpError(404, "Employee not found.");
  return row;
}

// ---------------------------------------------------------------------------------------------

router.get("/employees", async (request, response) => {
  const status = String(request.query?.status || "active");
  if (!["active", "resigned", "all"].includes(status)) throw httpError(400, "Status filter must be active, resigned or all.");
  const includeArchived = String(request.query?.includeArchived || "") === "1";
  const conditions = [];
  const params = [getManilaDateString()];
  if (status !== "all") {
    conditions.push("e.status = ?");
    params.push(status);
  }
  if (!includeArchived) conditions.push("e.is_archived = FALSE");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.execute(`${EMPLOYEE_SELECT} ${where} ORDER BY e.status ASC, e.full_name ASC`, params);
  const ratesUnlocked = hasValidNetIncomeAccess(request);
  response.json({ items: rows.map((row) => toEmployee(row, ratesUnlocked)), ratesLocked: !ratesUnlocked });
});

// Staff logins that can still be linked to an employee (plus the one already linked, if any).
router.get("/linkable-users", async (request, response) => {
  const employeeId = request.query?.employeeId ? parsePositiveIntId(request.query.employeeId, "Employee") : 0;
  const [rows] = await pool.execute(
    `SELECT u.id, COALESCE(u.display_name, u.username) AS name
       FROM users u
      WHERE u.role = 'staff' AND u.is_active = TRUE
        AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id AND e.id <> ?)
      ORDER BY name ASC`,
    [employeeId],
  );
  response.json({ items: rows.map((row) => ({ id: Number(row.id), name: row.name })) });
});

router.get("/employees/:id", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Employee");
  response.json({ employee: await loadEmployee(pool, id, hasValidNetIncomeAccess(request)) });
});

router.post("/employees", async (request, response) => {
  const body = request.body || {};
  const fullName = cleanText(body.fullName, "Full name", 120);
  const position = cleanText(body.position, "Position", 80);
  const employmentStatus = cleanEnum(body.employmentStatus || "probationary", EMPLOYMENT_STATUSES, "Employment status");
  const payBasis = cleanEnum(body.payBasis, PAY_BASES, "Pay basis");
  const dailyDivisor = body.dailyDivisor === undefined ? 313 : cleanDivisor(body.dailyDivisor);
  const startDate = cleanDate(body.startDate, "Start date");
  const rate = cleanRate(body.rate, payBasis);
  const ids = Object.fromEntries(
    Object.entries(GOVERNMENT_IDS).map(([key, spec]) => [spec.column, cleanGovernmentId(body.governmentIds?.[key], spec) ?? null]),
  );
  const actor = request.authUser.sub;

  const id = await inTransaction(async (connection) => {
    const userId = (await cleanLinkedUser(connection, body.userId)) ?? null;
    const [result] = await connection.execute(
      `INSERT INTO employees (
         user_id, full_name, position, employment_status, pay_basis, daily_divisor, start_date,
         sss_no, philhealth_no, pagibig_no, tin, created_by, updated_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, fullName, position, employmentStatus, payBasis, dailyDivisor, startDate,
        ids.sss_no, ids.philhealth_no, ids.pagibig_no, ids.tin, actor, actor],
    );
    await connection.execute(
      "INSERT INTO employee_pay_rates (employee_id, rate, effective_from, note, set_by) VALUES (?, ?, ?, ?, ?)",
      [result.insertId, rate, startDate, "Starting rate", actor],
    );
    return result.insertId;
  });
  response.status(201).json({ message: "Employee added.", employee: await loadEmployee(pool, id, hasValidNetIncomeAccess(request)) });
});

// Profile edits. Pay rate changes go through POST /employees/:id/rates so history is kept.
router.patch("/employees/:id", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Employee");
  const body = request.body || {};
  if (body.rate !== undefined) throw httpError(400, "Change the pay rate with “Change rate” so the old rate stays in the history.");

  await inTransaction(async (connection) => {
    const current = await lockEmployee(connection, id);
    const updates = {};
    if (body.fullName !== undefined) updates.full_name = cleanText(body.fullName, "Full name", 120);
    if (body.position !== undefined) updates.position = cleanText(body.position, "Position", 80);
    if (body.employmentStatus !== undefined) updates.employment_status = cleanEnum(body.employmentStatus, EMPLOYMENT_STATUSES, "Employment status");
    if (body.payBasis !== undefined) updates.pay_basis = cleanEnum(body.payBasis, PAY_BASES, "Pay basis");
    if (body.dailyDivisor !== undefined) updates.daily_divisor = cleanDivisor(body.dailyDivisor);
    if (body.startDate !== undefined) {
      updates.start_date = cleanDate(body.startDate, "Start date");
      const end = formatDbDateOnly(current.end_date);
      if (end && updates.start_date > end) throw httpError(400, "Start date cannot be after the last working day.");
    }
    for (const [key, spec] of Object.entries(GOVERNMENT_IDS)) {
      const value = cleanGovernmentId(body.governmentIds?.[key], spec);
      if (value !== undefined) updates[spec.column] = value;
    }
    const userId = await cleanLinkedUser(connection, body.userId, id);
    if (userId !== undefined) updates.user_id = userId;
    if (updates.pay_basis && updates.pay_basis !== current.pay_basis) {
      throw httpError(400, "Changing the pay basis changes what the rate means. Use “Change rate” and choose the new basis there.");
    }
    const columns = Object.keys(updates);
    if (!columns.length) return;
    await connection.execute(
      `UPDATE employees SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_by = ? WHERE id = ?`,
      [...columns.map((column) => updates[column]), request.authUser.sub, id],
    );
  });
  response.json({ message: "Employee updated.", employee: await loadEmployee(pool, id, hasValidNetIncomeAccess(request)) });
});

// New rate row (history is never edited). Optionally switches the pay basis at the same time.
router.post("/employees/:id/rates", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Employee");
  const body = request.body || {};
  await inTransaction(async (connection) => {
    const current = await lockEmployee(connection, id);
    if (current.status !== "active") throw httpError(400, "Reactivate this employee before changing their rate.");
    const payBasis = body.payBasis === undefined ? current.pay_basis : cleanEnum(body.payBasis, PAY_BASES, "Pay basis");
    const rate = cleanRate(body.rate, payBasis);
    const effectiveFrom = cleanDate(body.effectiveFrom || getManilaDateString(), "Effective date");
    if (effectiveFrom < formatDbDateOnly(current.start_date)) throw httpError(400, "A rate cannot start before the employee's start date.");
    const note = cleanText(body.note, "Note", 160, { required: false });
    if (payBasis !== current.pay_basis) {
      const [[later]] = await connection.execute(
        "SELECT COUNT(*) AS n FROM employee_pay_rates WHERE employee_id = ? AND effective_from > ?",
        [id, effectiveFrom],
      );
      if (Number(later.n) > 0) throw httpError(400, "A rate is already scheduled after this date under the old pay basis. Change rates in date order.");
      await connection.execute("UPDATE employees SET pay_basis = ?, updated_by = ? WHERE id = ?", [payBasis, request.authUser.sub, id]);
    }
    await connection.execute(
      "INSERT INTO employee_pay_rates (employee_id, rate, effective_from, note, set_by) VALUES (?, ?, ?, ?, ?)",
      [id, rate, effectiveFrom, note, request.authUser.sub],
    );
  });
  response.status(201).json({ message: "New rate saved. The old rate stays in the history.", employee: await loadEmployee(pool, id, hasValidNetIncomeAccess(request)) });
});

router.post("/employees/:id/resign", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Employee");
  const endDate = cleanDate(request.body?.endDate || getManilaDateString(), "Last working day");
  await inTransaction(async (connection) => {
    const current = await lockEmployee(connection, id);
    if (current.status === "resigned") throw httpError(400, "This employee is already marked as resigned.");
    if (endDate < formatDbDateOnly(current.start_date)) throw httpError(400, "Last working day cannot be before the start date.");
    await connection.execute(
      "UPDATE employees SET status = 'resigned', end_date = ?, updated_by = ? WHERE id = ?",
      [endDate, request.authUser.sub, id],
    );
  });
  response.json({ message: "Employee marked as resigned.", employee: await loadEmployee(pool, id, hasValidNetIncomeAccess(request)) });
});

router.post("/employees/:id/reactivate", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Employee");
  await inTransaction(async (connection) => {
    const current = await lockEmployee(connection, id);
    if (current.status === "active") throw httpError(400, "This employee is already active.");
    await connection.execute(
      "UPDATE employees SET status = 'active', end_date = NULL, is_archived = FALSE, archived_at = NULL, updated_by = ? WHERE id = ?",
      [request.authUser.sub, id],
    );
  });
  response.json({ message: "Employee reactivated.", employee: await loadEmployee(pool, id, hasValidNetIncomeAccess(request)) });
});

// Archive hides a resigned employee from the list. Records are never deleted (payroll history).
router.post("/employees/:id/archive", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Employee");
  await inTransaction(async (connection) => {
    const current = await lockEmployee(connection, id);
    if (current.status !== "resigned") throw httpError(400, "Mark the employee as resigned before archiving.");
    await connection.execute(
      "UPDATE employees SET is_archived = TRUE, archived_at = NOW(), user_id = NULL, updated_by = ? WHERE id = ?",
      [request.authUser.sub, id],
    );
  });
  response.json({ message: "Employee archived.", employee: await loadEmployee(pool, id, hasValidNetIncomeAccess(request)) });
});

router.post("/employees/:id/unarchive", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "Employee");
  await inTransaction(async (connection) => {
    await lockEmployee(connection, id);
    await connection.execute(
      "UPDATE employees SET is_archived = FALSE, archived_at = NULL, updated_by = ? WHERE id = ?",
      [request.authUser.sub, id],
    );
  });
  response.json({ message: "Employee restored to the list.", employee: await loadEmployee(pool, id, hasValidNetIncomeAccess(request)) });
});

router.use(payrollRunRoutes);

export default router;
