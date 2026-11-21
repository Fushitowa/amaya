import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import {
  round2,
  generateEntryNumber,
  getManilaDateString,
  assertValidDateRange,
  parseBoundedPositiveInt,
  postBalancedEntry,
  parseExactMoney,
  resolveActiveSessionId,
  isValidIsoDateOnly,
  manilaMonthOf,
} from "../utils/ledgerService.js";
import { parseOptionalClientRequestId } from "../utils/validation.js";
import { LIQUID_ACCOUNT_CODES, PAYROLL_LIABILITY_ACCOUNT_CODES } from "../utils/coaConstants.js";
import { formatDbDateOnly } from "../../../shared/manilaDate.js";
import { findPayrollOwnerOfEntry } from "../utils/payrollGuards.js";
import utilityBillRoutes, { loadUtilityEstimates, loadUtilityEstimatesForRange } from "./utilityBills.js";
import { planMonthlyLaborBudget } from "../../../shared/payrollComputation.js";
import { COST_TARGETS, normalizeCostTarget } from "../../../shared/costTargets.js";
import { DRAWER_DEFAULTS, isDrawerPattern, normalizeDrawerThresholds, validateDrawerThresholds } from "../../../shared/drawerThresholds.js";
import {
  EXPENSE_NAV_CATEGORIES,
  LEGACY_ACCOUNT_OWNER,
  PAYROLL_EXPENSE_ACCOUNT_CODES,
  ADJUSTMENT_EXPENSE_ACCOUNT_CODES,
  EXPENSE_REPORT_SECTIONS,
  getExpenseCategoryScope,
  getExpenseNavCategory,
} from "../../../shared/expenseNavigation.js";
import {
  getAccountsAndAssetsReport,
  getBalanceSheetReport,
  getCashFlowReport,
  getDailyReconciliationReport,
  getProfitAndLossReport,
  getTrialBalanceReport,
} from "../services/financesReportService.js";

const router = Router();

// Utility bills by service period (payroll plan O3.4–O3.9), admin only.
router.use("/utility-bills", utilityBillRoutes);

const PAYROLL_ONLY_MESSAGE =
  "Salaries, wages, overtime, government contributions and 13th month pay are recorded through Expenses and Payroll → Payroll Runs, so payslips and the ledger always match.";

function netIncomeTokenSecret() {
  const secret = (process.env.JWT_SECRET || "").trim();
  if (!secret || secret.length < 32 || /^(.)\1+$/.test(secret) || /^replace_with/i.test(secret)) {
    throw new Error("JWT_SECRET must be set to a high-entropy random value of at least 32 characters.");
  }
  return secret;
}

export function createNetIncomeAccessToken(userId) {
  return jwt.sign(
    { sub: String(userId), purpose: "view_net_income" },
    netIncomeTokenSecret(),
    { expiresIn: "15m", issuer: "amaya-api", audience: "amaya-net-income", algorithm: "HS256" },
  );
}

export function hasValidNetIncomeAccess(request) {
  const token = request.get("X-Net-Income-Token");
  if (!token) return false;
  try {
    const claims = jwt.verify(token, netIncomeTokenSecret(), {
      issuer: "amaya-api",
      audience: "amaya-net-income",
      algorithms: ["HS256"],
    });
    return claims.purpose === "view_net_income" && String(claims.sub) === String(request.authUser?.sub);
  } catch {
    return false;
  }
}

function parseOwnerPin(value) {
  const pin = String(value ?? "");
  if (!/^\d{4,6}$/.test(pin)) throw httpError(400, "Owner Numeric PIN must contain 4 to 6 numbers.");
  return pin;
}

// New PINs must be 6 digits (1,000,000 combinations); existing 4-5 digit PINs still unlock.
function parseNewOwnerPin(value) {
  const pin = String(value ?? "");
  if (!/^\d{6}$/.test(pin)) throw httpError(400, "Choose a 6-digit Owner Numeric PIN.");
  return pin;
}

const PIN_ATTEMPTS_PER_LOCK = 5;
// Each consecutive lockout lasts longer, so guessing stays slow: 5 min, 1 h, then 24 h.
// The lockout count resets after a correct PIN.
export function pinLockoutMinutes(lockoutNumber) {
  if (lockoutNumber <= 1) return 5;
  if (lockoutNumber === 2) return 60;
  return 24 * 60;
}

function describeMinutes(minutes) {
  if (minutes >= 24 * 60) return "24 hours";
  if (minutes >= 60) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

async function checkOwnerPin(connection, pin, userId) {
  const [[settings]] = await connection.execute(
    `SELECT owner_net_income_pin_hash, owner_net_income_pin_failed_attempts, owner_net_income_pin_locked_until,
            owner_net_income_pin_lockouts,
            (owner_net_income_pin_locked_until IS NOT NULL AND owner_net_income_pin_locked_until > NOW()) AS is_locked
       FROM business_settings WHERE id = 1 FOR UPDATE`,
  );
  if (!settings) throw httpError(503, "Business security settings are unavailable.");
  if (Number(settings.is_locked)) {
    const until = settings.owner_net_income_pin_locked_until;
    const err = httpError(429, `Too many incorrect PIN attempts. Try again after ${new Date(until).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}.`);
    err.lockedUntil = until;
    throw err;
  }
  if (!settings.owner_net_income_pin_hash) throw httpError(409, "Set an Owner Numeric PIN first.");
  const [[user]] = await connection.execute("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [userId]);
  const isAdminPassword = user ? await bcrypt.compare(pin, user.password_hash) : false;
  const matches = !isAdminPassword && await bcrypt.compare(pin, settings.owner_net_income_pin_hash);
  if (!matches) {
    const failedAttempts = Number(settings.owner_net_income_pin_failed_attempts || 0) + 1;
    const lockouts = Number(settings.owner_net_income_pin_lockouts || 0);
    if (failedAttempts >= PIN_ATTEMPTS_PER_LOCK) {
      const nextLockout = Math.min(lockouts + 1, 255);
      const minutes = pinLockoutMinutes(nextLockout);
      await connection.execute(
        `UPDATE business_settings
            SET owner_net_income_pin_failed_attempts = 0, owner_net_income_pin_lockouts = ?,
                owner_net_income_pin_locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE)
          WHERE id = 1`,
        [nextLockout, minutes],
      );
      throw httpError(429, `Too many incorrect PIN attempts. Net Income is locked for ${describeMinutes(minutes)}.`);
    }
    await connection.execute(
      "UPDATE business_settings SET owner_net_income_pin_failed_attempts = ?, owner_net_income_pin_locked_until = NULL WHERE id = 1",
      [failedAttempts],
    );
    const remaining = PIN_ATTEMPTS_PER_LOCK - failedAttempts;
    const nextLockMinutes = pinLockoutMinutes(lockouts + 1);
    throw httpError(401, `Incorrect Owner Numeric PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before a ${describeMinutes(nextLockMinutes)} lock.`);
  }
  await connection.execute(
    "UPDATE business_settings SET owner_net_income_pin_failed_attempts = 0, owner_net_income_pin_lockouts = 0, owner_net_income_pin_locked_until = NULL WHERE id = 1",
  );
}

router.get("/net-income-pin/status", requireAuth, requireRole("admin"), async (_request, response) => {
  const [[settings]] = await pool.execute(
    `SELECT owner_net_income_pin_hash IS NOT NULL AS has_pin,
            owner_net_income_pin_locked_until > NOW() AS is_locked,
            owner_net_income_pin_locked_until AS locked_until
       FROM business_settings WHERE id = 1 LIMIT 1`,
  );
  response.json({ hasPin: Boolean(settings?.has_pin), locked: Boolean(settings?.is_locked), lockedUntil: settings?.locked_until || null });
});

router.post("/net-income-pin/verify", requireAuth, requireRole("admin"), async (request, response) => {
  const pin = parseOwnerPin(request.body?.pin);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await checkOwnerPin(connection, pin, request.authUser.sub);
    await connection.commit();
  } catch (error) {
    await connection.commit();
    throw error;
  } finally {
    connection.release();
  }
  response.json({ accessToken: createNetIncomeAccessToken(request.authUser.sub), expiresInSeconds: 900 });
});

router.post("/net-income-pin/set", requireAuth, requireRole("admin"), async (request, response) => {
  const pin = parseNewOwnerPin(request.body?.pin);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[settings]] = await connection.execute(
      "SELECT owner_net_income_pin_hash FROM business_settings WHERE id = 1 FOR UPDATE",
    );
    if (!settings) throw httpError(503, "Business security settings are unavailable.");
    if (settings.owner_net_income_pin_hash) {
      const currentPin = parseOwnerPin(request.body?.currentPin);
      await checkOwnerPin(connection, currentPin, request.authUser.sub);
    }
    const [[user]] = await connection.execute("SELECT password_hash FROM users WHERE id = ? LIMIT 1", [request.authUser.sub]);
    if (user && await bcrypt.compare(pin, user.password_hash)) {
      throw httpError(400, "Choose a Numeric PIN that is different from your Admin login password.");
    }
    const hash = await bcrypt.hash(pin, 12);
    await connection.execute(
      `UPDATE business_settings
          SET owner_net_income_pin_hash = ?, owner_net_income_pin_failed_attempts = 0,
              owner_net_income_pin_lockouts = 0, owner_net_income_pin_locked_until = NULL
        WHERE id = 1`,
      [hash],
    );
    await connection.commit();
  } catch (error) {
    await connection.commit();
    throw error;
  } finally {
    connection.release();
  }
  response.json({ message: "Owner Numeric PIN saved.", accessToken: createNetIncomeAccessToken(request.authUser.sub), expiresInSeconds: 900 });
});

function budgetMonth(value) {
  const month = String(value || getManilaDateString().slice(0, 7));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw httpError(400, "Month must use YYYY-MM format.");
  return month;
}

async function getExpenseBudgetHealth(monthValue) {
  const month = budgetMonth(monthValue);
  const monthStart = `${month}-01`;
  const nextMonthStart = new Date(`${monthStart}T00:00:00Z`);
  nextMonthStart.setUTCMonth(nextMonthStart.getUTCMonth() + 1);
  const monthEndExclusive = nextMonthStart.toISOString().slice(0, 10);
  const allCodes = [...new Set(EXPENSE_NAV_CATEGORIES.flatMap((category) => category.accountCodes))];
  const [budgetRows] = await pool.execute(
    `SELECT ec.slug, eb.budget_amount, eb.date_set,
            COALESCE(u.display_name, u.username) AS set_by_name
       FROM expense_categories ec
       LEFT JOIN expense_budgets eb ON eb.category_id = ec.id AND eb.budget_month = ?
       LEFT JOIN users u ON u.id = eb.set_by`,
    [monthStart],
  );
  // Operating-expense records count their debits. Shift-close cash over/short (6040) and inventory
  // adjustments (6010) are posted as adjustments, so their net (debit − credit) counts instead.
  // Reversed entries and the reversals themselves are left out.
  const [spentRows] = await pool.execute(
    `SELECT coa.account_code, ec.slug AS category_slug,
            COALESCE(SUM(CASE WHEN je.entry_type = 'operating_expense' THEN jel.debit ELSE jel.debit - jel.credit END), 0.00) AS spent
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       LEFT JOIN expense_categories ec ON ec.id = je.expense_category_id
      WHERE (je.entry_type = 'operating_expense'
             OR (je.entry_type = 'adjustment' AND coa.account_code IN (${ADJUSTMENT_EXPENSE_ACCOUNT_CODES.map(() => "?").join(",")})))
        AND je.is_reversal = FALSE
        AND je.entry_date >= ? AND je.entry_date < ?
        AND coa.report_section IN ('opex', 'occupancy')
        AND coa.account_code IN (${allCodes.map(() => "?").join(",")})
        AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reverses_entry_id = je.id)
      GROUP BY coa.account_code, ec.slug`,
    [...ADJUSTMENT_EXPENSE_ACCOUNT_CODES, `${monthStart} 00:00:00`, `${monthEndExclusive} 00:00:00`, ...allCodes],
  );
  // Each record is credited to exactly one category: its tag, or (untagged) the single category
  // that owns its ledger account. A group then adds up its own records and its children's.
  const ownSpent = new Map();
  for (const row of spentRows) {
    const owner = row.category_slug || LEGACY_ACCOUNT_OWNER[String(row.account_code)];
    if (owner) ownSpent.set(owner, (ownSpent.get(owner) || 0) + Number(row.spent || 0));
  }
  const budgetBySlug = new Map(budgetRows.map((row) => [row.slug, row]));
  return EXPENSE_NAV_CATEGORIES.map((category) => {
    const row = budgetBySlug.get(category.slug);
    const { slugs } = getExpenseCategoryScope(category.slug);
    const spent = Math.round(slugs.reduce((sum, slug) => sum + (ownSpent.get(slug) || 0), 0) * 100) / 100;
    const budget = row?.budget_amount == null ? null : Number(row.budget_amount);
    const remaining = budget == null ? null : Math.round((budget - spent) * 100) / 100;
    const percentUsed = budget == null ? null : budget === 0 ? (spent > 0 ? 100 : 0) : Math.round((spent / budget) * 10000) / 100;
    const status = budget == null ? "no_budget" : spent > budget ? "over_budget" : percentUsed >= 85 ? "red" : percentUsed >= 60 ? "yellow" : "green";
    return {
      category: category.slug,
      label: category.label,
      accountCodes: category.accountCodes,
      month,
      budget,
      spent,
      remaining,
      percentUsed,
      status,
      setBy: row?.set_by_name || null,
      dateSet: row?.date_set || null,
      accountNote: category.accountNote || null,
      readOnly: Boolean(category.readOnly),
    };
  });
}

router.get("/expense-budgets/health", requireAuth, async (request, response) => {
  const month = budgetMonth(request.query?.month);
  const health = await getExpenseBudgetHealth(month);
  // Owners also see utility bills not in yet (estimated, not posted: D7).
  const estimates = request.authUser.role === "admin" ? await loadUtilityEstimates(month) : [];
  response.json({ month, items: health, estimates });
});

router.put("/expense-budgets/:category", requireAuth, requireRole("admin"), async (request, response) => {
  const category = getExpenseNavCategory(request.params.category);
  if (!category) throw httpError(404, "Expense category not found.");
  const month = budgetMonth(request.body?.month);
  const amount = parseExactMoney(request.body?.amount, "Budget amount", { allowZero: true });
  const monthStart = `${month}-01`;
  await pool.execute(
    `INSERT INTO expense_budgets (category_id, budget_month, budget_amount, set_by)
     SELECT id, ?, ?, ? FROM expense_categories WHERE slug = ?
     ON DUPLICATE KEY UPDATE budget_amount = VALUES(budget_amount), set_by = VALUES(set_by), date_set = CURRENT_TIMESTAMP`,
    [monthStart, amount, request.authUser.sub, category.slug],
  );
  const items = await getExpenseBudgetHealth(month);
  response.json({ message: "Monthly expense budget saved.", item: items.find((item) => item.category === category.slug) });
});

// -------------------------------------------------------------
// LABOR BUDGET AUTO-FILL (payroll plan P3.6)
// Salary, wages, contributions and 13th month come from the staff list; the owner sets only the
// overtime cap and the target labor %. The Labor and Payroll ceiling is that % of the average
// monthly net sales of the 3 months before. Needs the Owner PIN: it reveals what staff earn.
// -------------------------------------------------------------
function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function lastDayOfMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

async function buildLaborPlan(month, targetOverride = null) {
  const monthStart = `${month}-01`;
  const monthEnd = lastDayOfMonth(month);
  const [employees] = await pool.execute(
    `SELECT e.pay_basis, e.daily_divisor, e.start_date, e.end_date,
            (SELECT r.rate FROM employee_pay_rates r
              WHERE r.employee_id = e.id AND r.effective_from <= ?
              ORDER BY r.effective_from DESC, r.id DESC LIMIT 1) AS rate
       FROM employees e
      WHERE e.is_archived = FALSE AND e.start_date <= ? AND (e.end_date IS NULL OR e.end_date >= ?)`,
    [monthEnd, monthEnd, monthStart],
  );
  const plan = planMonthlyLaborBudget(
    employees.map((row) => ({
      payBasis: row.pay_basis,
      rate: row.rate == null ? 0 : Number(row.rate),
      dailyDivisor: Number(row.daily_divisor),
      startDate: formatDbDateOnly(row.start_date),
      endDate: row.end_date ? formatDbDateOnly(row.end_date) : null,
    })),
    month,
  );

  const salesMonths = [];
  for (let back = 3; back >= 1; back -= 1) {
    const salesMonth = shiftMonth(month, -back);
    const pnl = await getProfitAndLossReport(`${salesMonth}-01`, lastDayOfMonth(salesMonth));
    salesMonths.push({ month: salesMonth, netSales: round2(pnl.netSales) });
  }
  const withSales = salesMonths.filter((row) => row.netSales > 0);
  const averageNetSales = withSales.length
    ? round2(withSales.reduce((sum, row) => sum + row.netSales, 0) / withSales.length)
    : 0;

  const [[settingsRow]] = await pool.execute("SELECT target_labor_cost FROM business_settings WHERE id = 1 LIMIT 1");
  const targetLaborCost = targetOverride ?? normalizeCostTarget("targetLaborCost", settingsRow?.target_labor_cost);
  const [budgetRows] = await pool.execute(
    `SELECT ec.slug, eb.budget_amount FROM expense_budgets eb JOIN expense_categories ec ON ec.id = eb.category_id
      WHERE eb.budget_month = ? AND ec.slug IN ('overtime', 'staff-meals')`,
    [monthStart],
  );
  const existing = Object.fromEntries(budgetRows.map((row) => [row.slug, Number(row.budget_amount)]));
  const overtimeBudget = existing.overtime ?? 0;
  const staffMealsBudget = existing["staff-meals"] ?? 0;
  const ceiling = round2(targetLaborCost * averageNetSales);
  const planned = round2(plan.salary + plan.wages + plan.governmentContributions + plan.thirteenthMonth + overtimeBudget + staffMealsBudget);
  return {
    ...plan,
    overtimeBudget,
    staffMealsBudget,
    planned,
    targetLaborCost,
    salesMonths,
    averageNetSales,
    ceiling,
    overCeiling: ceiling > 0 && planned > ceiling,
  };
}

const LABOR_PIN_MESSAGE = "Enter the Owner PIN to plan the labor budget. Pay rates are private.";

router.get("/expense-budgets/labor-plan", requireAuth, requireRole("admin"), async (request, response) => {
  if (!hasValidNetIncomeAccess(request)) {
    return response.status(403).json({ message: LABOR_PIN_MESSAGE, pinRequired: true });
  }
  response.json(await buildLaborPlan(budgetMonth(request.query?.month)));
});

router.post("/expense-budgets/labor-plan/apply", requireAuth, requireRole("admin"), async (request, response) => {
  if (!hasValidNetIncomeAccess(request)) {
    return response.status(403).json({ message: LABOR_PIN_MESSAGE, pinRequired: true });
  }
  const month = budgetMonth(request.body?.month);
  let targetLaborCost = null;
  if (request.body?.targetLaborCost !== undefined && request.body?.targetLaborCost !== null && request.body?.targetLaborCost !== "") {
    const def = COST_TARGETS.targetLaborCost;
    const raw = Number(request.body.targetLaborCost);
    if (!Number.isFinite(raw) || raw < def.min || raw > def.max) {
      throw httpError(400, `Target labor cost must be between ${Math.round(def.min * 100)}% and ${Math.round(def.max * 100)}% (send it as a ratio, e.g. 0.30).`);
    }
    targetLaborCost = Number(raw.toFixed(4));
  }
  const overtimeBudget = request.body?.overtimeBudget === undefined || request.body?.overtimeBudget === null || request.body?.overtimeBudget === ""
    ? null
    : parseExactMoney(request.body.overtimeBudget, "Overtime cap", { allowZero: true });

  const plan = await buildLaborPlan(month, targetLaborCost);
  const writes = [
    ["salary", plan.salary],
    ["wages", plan.wages],
    ["government-contributions", plan.governmentContributions],
    ["thirteenth-month", plan.thirteenthMonth],
  ];
  if (overtimeBudget !== null) writes.push(["overtime", overtimeBudget]);
  if (plan.ceiling > 0) writes.push(["labor-and-payroll", plan.ceiling]);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [slug, amount] of writes) {
      await connection.execute(
        `INSERT INTO expense_budgets (category_id, budget_month, budget_amount, set_by)
         SELECT id, ?, ?, ? FROM expense_categories WHERE slug = ?
         ON DUPLICATE KEY UPDATE budget_amount = VALUES(budget_amount), set_by = VALUES(set_by), date_set = CURRENT_TIMESTAMP`,
        [`${month}-01`, round2(amount), request.authUser.sub, slug],
      );
    }
    if (targetLaborCost !== null) {
      await connection.execute("UPDATE business_settings SET target_labor_cost = ? WHERE id = 1", [targetLaborCost]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  response.json({ message: "Labor budgets filled from the staff list.", plan: await buildLaborPlan(month) });
});

router.post("/expense-records", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const category = getExpenseNavCategory(request.body?.category);
  if (!category) throw httpError(400, "Choose a valid expense category.");
  if (PAYROLL_EXPENSE_ACCOUNT_CODES.includes(category.accountCodes[0])) {
    throw httpError(400, PAYROLL_ONLY_MESSAGE);
  }
  if (category.readOnly) {
    throw httpError(400, `${category.label} is posted automatically and cannot be recorded by hand.`);
  }
  const description = String(request.body?.description || "").trim().slice(0, 180);
  if (!description) throw httpError(400, "An item or expense description is required.");
  const amount = parseExactMoney(request.body?.amount, "Expense amount");
  const isStaff = request.authUser.role === "staff";
  const today = getManilaDateString();
  const date = String(request.body?.date || today).trim();
  if (!isValidIsoDateOnly(date)) throw httpError(400, "Expense date must use YYYY-MM-DD format.");
  const channelMap = {
    cash_counter: "1010",
    gcash: "1020",
    store_bank: "1030",
    owner_reserve: "1040",
  };
  const creditAccountCode = channelMap[String(request.body?.channel || "")];
  if (!creditAccountCode) throw httpError(400, "Choose a valid money channel.");
  // Staff only handle the counter drawer: GCash, bank, and owner reserve payments
  // (and backdated entries) belong to the owner.
  if (isStaff && creditAccountCode !== "1010") {
    throw httpError(403, "Staff can only record expenses paid from the counter cash drawer. Ask the owner to record GCash, bank, or reserve payments.");
  }
  if (isStaff && date !== today) {
    throw httpError(400, "Staff can only record expenses for today.");
  }
  const notes = String(request.body?.notes || "").trim().slice(0, 150);
  const receiptReference = String(request.body?.receiptReference || "").trim().slice(0, 100);
  const memo = `${description}${notes ? ` · ${notes}` : ""}`.slice(0, 255);
  // 64 chars max so "expense:<userId>:<id>" fits journal_entries.idempotency_key (VARCHAR 96).
  const cleanClientRequestId = parseOptionalClientRequestId(request.body?.clientRequestId, { maxLength: 64 });
  // Retries (double-tap, slow Wi-Fi) with the same clientRequestId return the first
  // entry instead of posting the expense twice.
  const idempotencyKey = cleanClientRequestId ? `expense:${request.authUser.sub}:${cleanClientRequestId}` : null;
  const lines = [
    { accountCode: category.accountCodes[0], debit: amount, credit: 0, lineMemo: description },
    { accountCode: creditAccountCode, debit: 0, credit: amount, lineMemo: "Expense payment" },
  ];
  const replayResponse = async (entryId) => {
    await assertJournalReplayMatches(pool, entryId, "operating_expense", lines);
    return response.status(200).json({ message: "Expense already recorded.", entryId, amount, category: category.slug, replayed: true });
  };
  if (idempotencyKey) {
    const [[existing]] = await pool.execute("SELECT id FROM journal_entries WHERE idempotency_key = ? LIMIT 1", [idempotencyKey]);
    if (existing) return replayResponse(Number(existing.id));
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Counter-cash expenses must be tied to the payer's open shift so the shift's
    // expected cash drops by the same amount; otherwise closing the shift reports
    // a false shortage and credits 1010 a second time.
    let sessionId = null;
    if (creditAccountCode === "1010") {
      const [[openSession]] = await connection.execute(
        "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1 FOR UPDATE",
        [request.authUser.sub],
      );
      sessionId = openSession ? Number(openSession.id) : null;
      if (isStaff && !sessionId) {
        throw httpError(409, "Open your cashier shift before paying an expense from the counter cash.");
      }
    }
    const result = await postBalancedEntry(connection, {
      entryType: "operating_expense",
      memo,
      referenceNumber: receiptReference || null,
      entryDate: `${date} 12:00:00`,
      sessionId,
      idempotencyKey,
      createdBy: request.authUser.sub,
      lines,
    });
    if (result.skipped) {
      // A concurrent request with the same clientRequestId won the race.
      await connection.rollback();
      if (result.entryId) return replayResponse(result.entryId);
      throw httpError(409, "This expense is already being recorded. Please refresh.");
    }
    await connection.execute(
      `UPDATE journal_entries je JOIN expense_categories ec ON ec.slug = ?
          SET je.expense_category_id = ec.id WHERE je.id = ?`,
      [category.slug, result.entryId],
    );
    await connection.commit();
    response.status(201).json({ message: "Expense recorded.", entryId: result.entryId, amount, category: category.slug });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
});

function parseOptionalOpeningAmount(rawValue, label) {
  if (rawValue === undefined || rawValue === null) return 0;
  if (typeof rawValue === "string" && rawValue.trim() === "") return 0;
  return parseExactMoney(rawValue, label, { allowZero: true });
}

async function assertJournalReplayMatches(executor, existingEntryId, expectedEntryType, expectedLines) {
  const [[header]] = await executor.execute(
    "SELECT id, entry_type FROM journal_entries WHERE id = ? LIMIT 1",
    [existingEntryId],
  );
  if (!header) {
    throw httpError(409, "Client request ID conflict with an existing journal transaction.");
  }
  if (header.entry_type !== expectedEntryType) {
    throw httpError(409, "Client request ID was already used for a different journal entry type.");
  }

  const [storedRows] = await executor.execute(
    `SELECT coa.account_code,
            COALESCE(SUM(jel.debit), 0.00) AS total_debit,
            COALESCE(SUM(jel.credit), 0.00) AS total_credit
       FROM journal_entry_lines jel
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE jel.journal_entry_id = ?
      GROUP BY coa.account_code`,
    [existingEntryId],
  );

  const storedMap = new Map();
  let storedTotal = 0;
  for (const r of storedRows) {
    const d = round2(r.total_debit);
    const c = round2(r.total_credit);
    storedMap.set(String(r.account_code), { debit: d, credit: c });
    storedTotal += d;
  }

  const expectedMap = new Map();
  for (const l of expectedLines) {
    const code = String(l.accountCode);
    const prev = expectedMap.get(code) || { debit: 0, credit: 0 };
    expectedMap.set(code, {
      debit: round2(prev.debit + round2(l.debit)),
      credit: round2(prev.credit + round2(l.credit)),
    });
  }

  if (storedMap.size !== expectedMap.size) {
    throw httpError(409, "Client request ID was already used with a different journal payload.");
  }
  for (const [code, exp] of expectedMap.entries()) {
    const got = storedMap.get(code);
    if (!got || Math.abs(got.debit - exp.debit) >= 0.005 || Math.abs(got.credit - exp.credit) >= 0.005) {
      throw httpError(409, "Client request ID was already used with a different journal payload.");
    }
  }
  return round2(storedTotal);
}

/**
 * Compares money leaving liquid accounts (1010-1040) with what each account really holds
 * (counter cash the owner has not yet confirmed is left out). Returns one entry per account that
 * would go short. Locks the account rows first, so call it inside an open transaction.
 */
async function findLiquidShortfalls(connection, outflowLines) {
  const outflows = new Map();
  for (const line of outflowLines) {
    if (!LIQUID_ACCOUNT_CODES.has(line.accountCode)) continue;
    const credit = round2(line.credit);
    if (credit > 0) outflows.set(line.accountCode, round2((outflows.get(line.accountCode) || 0) + credit));
  }
  const codes = [...outflows.keys()].sort();
  if (!codes.length) return [];
  await connection.execute(
    `SELECT id FROM chart_of_accounts WHERE account_code IN (${codes.map(() => "?").join(",")}) ORDER BY account_code ASC FOR UPDATE`,
    codes,
  );
  const shortfalls = [];
  for (const accountCode of codes) {
    const [[glRow]] = await connection.execute(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0.00) AS gl_balance
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE coa.account_code = ?`,
      [accountCode],
    );
    let availableBalance = round2(glRow?.gl_balance || 0);
    if (accountCode === "1010") {
      const [[unconfirmedRow]] = await connection.execute(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0.00) AS unconfirmed_counter_cash
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
           JOIN orders o ON o.id = je.order_id
          WHERE coa.account_code = '1010'
            AND o.payment_status = 'Paid'
            AND o.order_status <> 'Cancelled'
            AND o.owner_confirmed_at IS NULL`,
      );
      availableBalance = round2(availableBalance - round2(Math.max(0, Number(unconfirmedRow?.unconfirmed_counter_cash || 0))));
    }
    const leaving = outflows.get(accountCode);
    if (leaving > availableBalance + 0.001) {
      shortfalls.push({ accountCode, leaving, available: Math.max(0, availableBalance) });
    }
  }
  return shortfalls;
}

/** Hard stop: money may not leave a liquid account that does not hold it. `verb` words the error. */
async function assertLiquidFunds(connection, outflowLines, verb) {
  const [first] = await findLiquidShortfalls(connection, outflowLines);
  if (first) {
    throw httpError(
      409,
      `Insufficient confirmed funds in account ${first.accountCode}: trying to ${verb} ₱${first.leaving.toFixed(2)}, but available confirmed balance is ₱${first.available.toFixed(2)}.`,
    );
  }
}

/** Soft check for payments: the entry still posts, but the response tells the admin the account is short. */
async function liquidShortfallWarnings(connection, outflowLines) {
  const shortfalls = await findLiquidShortfalls(connection, outflowLines);
  return shortfalls.map((item) => `Account ${item.accountCode} only holds ₱${item.available.toFixed(2)} confirmed, so this ₱${item.leaving.toFixed(2)} payment leaves it short. Record the missing deposit or opening balance if the money really was there.`);
}

// Expense pages already show manual operating expenses, so those stay visible. What the PIN keeps
// private is everything else Net Income is worked out from: cost of goods, payroll, depreciation,
// tax and owner equity. An entry touching any of them hides all its amounts (its cash side would
// otherwise give the figure away).
const JOURNAL_LOCKED_REPORT_SECTIONS = new Set(["cogs", "depreciation", "tax"]);

function isProfitSensitiveJournalLine(line) {
  return JOURNAL_LOCKED_REPORT_SECTIONS.has(String(line.reportSection || ""))
    || String(line.category || "").toLowerCase() === "equity"
    || PAYROLL_EXPENSE_ACCOUNT_CODES.includes(String(line.accountCode));
}

/** Hide the amounts of any journal entry that touches a profit-sensitive account (PIN-locked view). */
export function lockJournalEntries(items) {
  return items.map((item) => {
    if (!item.lines.some(isProfitSensitiveJournalLine)) return item;
    return {
      ...item,
      amountsLocked: true,
      totalDebit: null,
      totalCredit: null,
      lines: item.lines.map((line) => ({ ...line, debit: null, credit: null })),
    };
  });
}

// -------------------------------------------------------------
// 1. TRIAL BALANCE & RECONCILIATION SUMMARY (Admin Only)
// -------------------------------------------------------------
router.all(["/accounts", "/accounts/:id"], requireAuth, requireRole("admin"), (request, response, next) => {
  if (["PUT", "PATCH", "DELETE", "POST"].includes(request.method)) {
    return response.status(405).json({
      message: "Account balances are strictly derived from journal ledger entries and cannot be directly modified.",
    });
  }
  next();
});

router.all("/journal-entries/:id", requireAuth, requireRole("admin"), (request, response, next) => {
  if (["PUT", "PATCH", "DELETE"].includes(request.method)) {
    return response.status(405).json({
      message: "Financial records are strictly immutable. Journal entries cannot be edited or deleted; corrections must be posted as traceable reversals via POST /api/finances/journal-entries/:id/reverse.",
    });
  }
  next();
});

// -------------------------------------------------------------
// NET INCOME PIN LOCK
// Until the owner enters the Net Income PIN, every figure from which profit can be
// worked out stays hidden: COGS, gross profit, operating expenses, depreciation, tax,
// net income, equity, and revenue/expense account balances. Sales, cash, assets and
// liabilities stay visible. Each response says `profitLocked: true` while locked.
// -------------------------------------------------------------
// Labor and USAR figures (payroll plan P3.5 / O3.7): payroll totals are private, and together with
// sales they would give away net income. Locked everywhere they appear.
export const LABOR_LOCKED_KEYS = Object.freeze([
  "laborCost", "laborPercent", "primeCost", "primeCostPercent", "salesPerLaborHour", "laborHours",
  "controllableExpenses", "controllableIncome", "controllableIncomePercent",
  "utilitiesCost", "utilitiesPercent", "totalOccupancy", "occupancyPercent", "restaurantOperatingIncome",
]);
const LOCKED_SUMMARY_KEYS = [
  "netIncome", "netProfitAfterSale", "allTimeNetProfit", "baseCapitalMoney",
  "grossProfit", "grossMarginPercent", "cogs", "customerSalesCogs", "foodSpoilageCogs", "inventoryShrinkage", "wasteCost",
  "operatingExpenses", "totalOperatingExpenses", "depreciation", "tax", "totalCogsAndExpenses",
  ...LABOR_LOCKED_KEYS,
];

/** Null the labor / USAR keys present on `target` (reports routes use this while the PIN is locked). */
export function lockLaborKeys(target) {
  for (const key of LABOR_LOCKED_KEYS) {
    if (target && key in target) target[key] = null;
  }
  return target;
}
const PNL_VISIBLE_WHEN_LOCKED = new Set(["grossSales", "discounts", "netSales"]);
const BALANCE_SHEET_ACCOUNT_CATEGORIES = new Set(["asset", "liability"]);

export function lockAccountsReport(report) {
  for (const key of LOCKED_SUMMARY_KEYS) {
    if (key in report.summary) report.summary[key] = null;
  }
  report.summary.profitLocked = true;
  // Keep every account (the expense forms list them) but hide revenue/expense/equity balances.
  report.accounts = (report.accounts || []).map((account) =>
    BALANCE_SHEET_ACCOUNT_CATEGORIES.has(String(account.category || "").toLowerCase())
      ? account
      : { ...account, balance: null });
  return report;
}

export function lockProfitAndLossReport(report) {
  const locked = Object.fromEntries(
    Object.entries(report).map(([key, value]) => [key, PNL_VISIBLE_WHEN_LOCKED.has(key) ? value : null]),
  );
  locked.operatingExpenses = [];
  locked.usarGroups = [];
  locked.utilityEstimates = [];
  locked.profitLocked = true;
  return locked;
}

export function lockBalanceSheetReport(report) {
  report.equity = Object.fromEntries(Object.keys(report.equity || {}).map((key) => [key, null]));
  report.totalEquity = null;
  report.profitLocked = true;
  return report;
}

router.get("/trial-balance", requireAuth, requireRole("admin"), async (request, response) => {
  if (!hasValidNetIncomeAccess(request)) {
    return response.status(403).json({ message: "Enter the Net Income PIN to view the Trial Balance.", profitLocked: true });
  }
  response.json(await getTrialBalanceReport());
});

// -------------------------------------------------------------
// 2. ACCOUNTS & STORE TOTAL ASSETS OVERVIEW (Admin Only)
// -------------------------------------------------------------
router.get("/accounts", requireAuth, requireRole("admin"), async (request, response) => {
  const report = await getAccountsAndAssetsReport(request.query?.from, request.query?.to);
  response.json(hasValidNetIncomeAccess(request) ? report : lockAccountsReport(report));
});

// -------------------------------------------------------------
// 3. INITIAL CAPITAL / OPENING BALANCE REGISTRATION (Admin Only)
// -------------------------------------------------------------
router.post("/opening-balance", requireAuth, requireRole("admin"), async (request, response) => {
  const {
    cashDrawer = 0,
    gcash = 0,
    bank = 0,
    capitalReserve = 0,
    equipment = 0,
    notes = "Initial business capital registration",
    clientRequestId,
  } = request.body || {};

  if (notes !== undefined && typeof notes !== "string") {
    throw httpError(400, "Opening balance notes must be a string.");
  }
  const cleanNotes = String(notes || "Initial business capital registration").trim().slice(0, 255) || "Initial business capital registration";
  const cleanClientRequestId = parseOptionalClientRequestId(clientRequestId);

  const numCash = parseOptionalOpeningAmount(cashDrawer, "Cash drawer amount");
  const numGcash = parseOptionalOpeningAmount(gcash, "GCash amount");
  const numBank = parseOptionalOpeningAmount(bank, "Bank amount");
  const numReserve = parseOptionalOpeningAmount(capitalReserve, "Capital reserve amount");
  const numEquip = parseOptionalOpeningAmount(equipment, "Equipment amount");

  const totalOpeningDebits = round2(numCash + numGcash + numBank + numReserve + numEquip);
  if (totalOpeningDebits <= 0) {
    throw httpError(400, "Initial capital must be greater than zero across registered accounts.");
  }

  const lines = [];
  if (numCash > 0) lines.push({ accountCode: "1010", debit: numCash, credit: 0, lineMemo: "Opening Cash Drawer" });
  if (numGcash > 0) lines.push({ accountCode: "1020", debit: numGcash, credit: 0, lineMemo: "Opening GCash Wallet" });
  if (numBank > 0) lines.push({ accountCode: "1030", debit: numBank, credit: 0, lineMemo: "Opening Bank Account" });
  if (numReserve > 0) lines.push({ accountCode: "1040", debit: numReserve, credit: 0, lineMemo: "Opening Capital Reserve" });
  if (numEquip > 0) lines.push({ accountCode: "1510", debit: numEquip, credit: 0, lineMemo: "Opening Store Equipment" });
  lines.push({ accountCode: "3010", debit: 0, credit: totalOpeningDebits, lineMemo: "Owner Capital Contribution" });

  if (cleanClientRequestId) {
    const [[existing]] = await pool.execute(
      "SELECT id FROM journal_entries WHERE idempotency_key = ? LIMIT 1",
      [cleanClientRequestId],
    );
    if (existing) {
      const storedAmount = await assertJournalReplayMatches(pool, Number(existing.id), "opening_balance", lines);
      return response.status(200).json({
        message: "Initial business capital already recorded (idempotent replay).",
        entryId: Number(existing.id),
        totalInitialCapital: storedAmount,
      });
    }
  }

  const connection = await pool.getConnection();
  let txOpen = false;
  let ledgerResult;
  try {
    await connection.beginTransaction();
    txOpen = true;

    ledgerResult = await postBalancedEntry(connection, {
      entryType: "opening_balance",
      memo: cleanNotes,
      idempotencyKey: cleanClientRequestId,
      createdBy: request.authUser.sub,
      lines,
    });
    if (ledgerResult.skipped) {
      await connection.rollback();
      txOpen = false;
      const storedAmount = ledgerResult.entryId
        ? await assertJournalReplayMatches(connection, Number(ledgerResult.entryId), "opening_balance", lines)
        : totalOpeningDebits;
      return response.status(200).json({
        message: "Initial business capital already recorded (idempotent replay).",
        entryId: ledgerResult.entryId,
        totalInitialCapital: storedAmount,
      });
    }

    await connection.commit();
    txOpen = false;
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }

  response.status(201).json({
    message: "Initial business capital recorded successfully with balanced double entries.",
    entryId: ledgerResult.entryId,
    totalInitialCapital: totalOpeningDebits,
  });
});

// -------------------------------------------------------------
// 4. JOURNAL ENTRIES LIST & SEARCH (Admin Only)
// -------------------------------------------------------------
router.get("/journal-entries", requireAuth, requireRole("admin"), async (request, response) => {
  const { type, from, to, page, limit, accountCodes, expenseCategory, q, minAmount, maxAmount } = request.query || {};
  const { from: cleanFrom, to: cleanTo } = assertValidDateRange(from, to);
  const numPage = parseBoundedPositiveInt(page, 1, 1, 100_000, "Page");
  const numLimit = parseBoundedPositiveInt(limit, 25, 1, 100, "Limit");
  const offset = (numPage - 1) * numLimit;

  const conditions = [];
  const params = [];

  if (type) {
    conditions.push("je.entry_type = ?");
    params.push(String(type).trim());
  }
  if (expenseCategory !== undefined && expenseCategory !== "") {
    const category = getExpenseNavCategory(String(expenseCategory).trim());
    if (!category) throw httpError(400, "Invalid expense category filter.");
    // Same scope as Budget Health: tagged with this category or a child, or untagged on an
    // account this category owns. An untagged record never shows on two sibling pages.
    const scope = getExpenseCategoryScope(category.slug);
    const legacyCondition = scope.legacyAccountCodes.length
      ? `OR (je.expense_category_id IS NULL AND EXISTS (
        SELECT 1 FROM journal_entry_lines jel_expense_filter
        JOIN chart_of_accounts coa_expense_filter ON coa_expense_filter.id = jel_expense_filter.account_id
        WHERE jel_expense_filter.journal_entry_id = je.id AND (jel_expense_filter.debit > 0 OR jel_expense_filter.credit > 0)
          AND coa_expense_filter.report_section IN ('opex', 'occupancy')
          AND coa_expense_filter.account_code IN (${scope.legacyAccountCodes.map(() => "?").join(",")})
      ))`
      : "";
    conditions.push(`(je.expense_category_id IN (SELECT ec.id FROM expense_categories ec WHERE ec.slug IN (${scope.slugs.map(() => "?").join(",")}))
      ${legacyCondition})`);
    params.push(...scope.slugs, ...scope.legacyAccountCodes);
  } else if (accountCodes !== undefined && accountCodes !== "") {
    const cleanAccountCodes = [...new Set(String(accountCodes).split(",").map((code) => code.trim()).filter(Boolean))];
    if (!cleanAccountCodes.length || cleanAccountCodes.length > 25 || cleanAccountCodes.some((code) => !/^\d{4}$/.test(code))) {
      throw httpError(400, "Invalid accountCodes filter. Provide up to 25 four-digit account codes.");
    }
    conditions.push(`EXISTS (
      SELECT 1
        FROM journal_entry_lines jel_expense_filter
        JOIN chart_of_accounts coa_expense_filter ON coa_expense_filter.id = jel_expense_filter.account_id
       WHERE jel_expense_filter.journal_entry_id = je.id
         AND jel_expense_filter.debit > 0
         AND coa_expense_filter.report_section IN ('opex', 'occupancy')
         AND coa_expense_filter.account_code IN (${cleanAccountCodes.map(() => "?").join(",")})
    )`);
    params.push(...cleanAccountCodes);
  }
  if (cleanFrom) {
    conditions.push("je.entry_date >= ?");
    params.push(`${cleanFrom} 00:00:00`);
  }
  if (cleanTo) {
    conditions.push("je.entry_date <= ?");
    params.push(`${cleanTo} 23:59:59`);
  }
  // Free-text search over what a person remembers: the note, the reference or the entry number.
  const searchText = q === undefined ? "" : String(q).trim().slice(0, 100);
  if (searchText) {
    const like = `%${searchText.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    conditions.push("(je.memo LIKE ? OR je.entry_number LIKE ? OR je.reference_number LIKE ?)");
    params.push(like, like, like);
  }
  // Filtering by amount would let someone narrow down a hidden figure one guess at a time, so it
  // needs the Net Income PIN like the amounts themselves.
  const hasAmountFilter = (minAmount !== undefined && minAmount !== "") || (maxAmount !== undefined && maxAmount !== "");
  if (hasAmountFilter) {
    if (!hasValidNetIncomeAccess(request)) {
      throw httpError(403, "Enter the Net Income PIN to filter by amount.");
    }
    const totalSql = "(SELECT COALESCE(SUM(f.debit), 0) FROM journal_entry_lines f WHERE f.journal_entry_id = je.id)";
    if (minAmount !== undefined && minAmount !== "") {
      conditions.push(`${totalSql} >= ?`);
      params.push(parseExactMoney(minAmount, "Minimum amount", { allowZero: true }));
    }
    if (maxAmount !== undefined && maxAmount !== "") {
      conditions.push(`${totalSql} <= ?`);
      params.push(parseExactMoney(maxAmount, "Maximum amount", { allowZero: true }));
    }
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM journal_entries je ${whereClause}`,
    params
  );

  const [entries] = await pool.query(
    `SELECT je.*,
            COALESCE(u.display_name, u.username) AS creator_name,
            EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = je.id) AS is_already_reversed
       FROM journal_entries je
       LEFT JOIN users u ON u.id = je.created_by
       ${whereClause}
      ORDER BY je.entry_date DESC, je.id DESC
      LIMIT ? OFFSET ?`,
    [...params, numLimit, offset]
  );

  const entryIds = entries.map((e) => e.id);
  let linesMap = new Map();

  if (entryIds.length > 0) {
    const [lines] = await pool.query(
      `SELECT jel.*,
              coa.account_code,
              coa.account_name,
              coa.account_category,
              coa.report_section
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id IN (${entryIds.map(() => "?").join(",")})
        ORDER BY jel.id ASC`,
      entryIds
    );

    for (const l of lines) {
      if (!linesMap.has(l.journal_entry_id)) {
        linesMap.set(l.journal_entry_id, []);
      }
      linesMap.get(l.journal_entry_id).push({
        id: Number(l.id),
        accountId: Number(l.account_id),
        accountCode: l.account_code,
        accountName: l.account_name,
        category: l.account_category,
        reportSection: l.report_section,
        debit: round2(l.debit),
        credit: round2(l.credit),
        lineMemo: l.line_memo || "",
      });
    }
  }

  const items = entries.map((e) => {
    const entryLines = linesMap.get(e.id) || [];
    const totalDebit = round2(entryLines.reduce((sum, l) => sum + l.debit, 0));
    const totalCredit = round2(entryLines.reduce((sum, l) => sum + l.credit, 0));
    return {
      id: Number(e.id),
      entryNumber: e.entry_number,
      entryDate: e.entry_date,
      entryType: e.entry_type,
      memo: e.memo,
      referenceNumber: e.reference_number || null,
      orderId: e.order_id ? Number(e.order_id) : null,
      sessionId: e.session_id ? Number(e.session_id) : null,
      payableId: e.payable_id ? Number(e.payable_id) : null,
      isReversal: Boolean(e.is_reversal),
      isAlreadyReversed: Boolean(e.is_already_reversed),
      reversesEntryId: e.reverses_entry_id ? Number(e.reverses_entry_id) : null,
      createdBy: Number(e.created_by),
      creatorName: e.creator_name,
      totalDebit,
      totalCredit,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.005,
      amountsLocked: false,
      lines: entryLines,
    };
  });

  const profitUnlocked = hasValidNetIncomeAccess(request);
  response.json({
    items: profitUnlocked ? items : lockJournalEntries(items),
    profitLocked: !profitUnlocked,
    total: Number(countRow?.total || 0),
    page: numPage,
    limit: numLimit,
  });
});

// -------------------------------------------------------------
// 5. MANUAL JOURNAL ENTRY CREATION (Admin Only)
// -------------------------------------------------------------
router.post("/journal-entries", requireAuth, requireRole("admin"), async (request, response) => {
  const {
    entryType = "operating_expense",
    amount,
    debitAmount,
    creditAmount,
    debitAccountCode,
    creditAccountCode,
    lines: rawLines,
    memo,
    referenceNumber = null,
    clientRequestId,
    vendorName = null,
    dueDate = null,
    expenseCategory = null,
    entryDate: rawEntryDate = null,
  } = request.body || {};

  if (typeof memo !== "string" || memo.trim().length === 0) {
    throw httpError(400, "A descriptive memo is required for audit trails.");
  }
  const cleanMemo = memo.trim().slice(0, 255);

  if (vendorName !== null && vendorName !== undefined && typeof vendorName !== "string") {
    throw httpError(400, "Vendor name must be a string.");
  }
  const cleanVendorName = vendorName ? String(vendorName).trim().slice(0, 120) || null : null;

  let cleanDueDate = null;
  if (dueDate !== null && dueDate !== undefined && String(dueDate).trim() !== "") {
    cleanDueDate = String(dueDate).trim();
    if (!isValidIsoDateOnly(cleanDueDate)) {
      throw httpError(400, "Invalid dueDate. Expected YYYY-MM-DD.");
    }
  }

  const cleanClientRequestId = parseOptionalClientRequestId(clientRequestId);
  // Only operating expenses may be dated on a past day (a receipt entered late); never in the future.
  let cleanEntryDate = null;
  if (rawEntryDate !== null && rawEntryDate !== undefined && String(rawEntryDate).trim() !== "") {
    const requested = String(rawEntryDate).trim();
    if (!isValidIsoDateOnly(requested)) throw httpError(400, "Invalid entryDate. Expected YYYY-MM-DD.");
    if (entryType !== "operating_expense") throw httpError(400, "Only operating expenses can be dated on a past day.");
    const today = getManilaDateString();
    if (requested > today) throw httpError(400, "The expense date cannot be in the future.");
    if (requested < today) cleanEntryDate = `${requested} 12:00:00`;
  }
  let cleanExpenseCategory = null;
  if (expenseCategory !== null && expenseCategory !== undefined && String(expenseCategory).trim()) {
    cleanExpenseCategory = getExpenseNavCategory(String(expenseCategory).trim());
    if (!cleanExpenseCategory) throw httpError(400, "Invalid expense category.");
    if (entryType !== "operating_expense") throw httpError(400, "Expense categories can only be attached to operating expenses.");
  }

  const validTypes = [
    "operating_expense",
    "capital_injection",
    "owner_withdrawal",
    "account_transfer",
    "adjustment",
    "inventory_restock",
    "opening_balance",
    "ap_settlement",
    "depreciation",
    "income_tax",
  ];
  if (!validTypes.includes(entryType)) {
    throw httpError(400, `Invalid entryType. Allowed types: ${validTypes.join(", ")}`);
  }
  if (entryType === "inventory_restock") {
    throw httpError(
      400,
      "Inventory restocks must be recorded via POST /api/inventory/:id/restock so stock quantities and payables stay synchronized.",
    );
  }

  let finalLines = [];

  if (Array.isArray(rawLines) && rawLines.length > 0) {
    if (rawLines.length < 2) {
      throw httpError(400, "A journal entry must contain at least 2 balanced line items.");
    }
    let totalD = 0;
    let totalC = 0;
    const accountSides = new Map();

    for (const l of rawLines) {
      if (!l || typeof l !== "object") {
        throw httpError(400, "Each journal line must be a valid object.");
      }
      const accCode = String(l.accountCode || "").trim();
      if (!accCode) throw httpError(400, "Every journal entry line requires a valid accountCode.");

      const d = (l.debit === undefined || l.debit === null || (typeof l.debit === "string" && l.debit.trim() === ""))
        ? 0
        : parseExactMoney(l.debit, "Journal line debit", { allowZero: true });
      const c = (l.credit === undefined || l.credit === null || (typeof l.credit === "string" && l.credit.trim() === ""))
        ? 0
        : parseExactMoney(l.credit, "Journal line credit", { allowZero: true });

      if (d > 0 && c > 0) {
        throw httpError(400, `Line for account '${accCode}' cannot have both positive debit and positive credit.`);
      }
      if (d === 0 && c === 0) {
        throw httpError(400, `Line for account '${accCode}' must specify a positive debit or credit amount.`);
      }

      const side = accountSides.get(accCode) || { hasDebit: false, hasCredit: false };
      if ((d > 0 && side.hasCredit) || (c > 0 && side.hasDebit)) {
        throw httpError(400, `Self-offsetting debit and credit on account '${accCode}' is not allowed in one entry.`);
      }
      side.hasDebit = side.hasDebit || d > 0;
      side.hasCredit = side.hasCredit || c > 0;
      accountSides.set(accCode, side);

      totalD += d;
      totalC += c;
      finalLines.push({
        accountCode: accCode,
        debit: d,
        credit: c,
        lineMemo: String(l.lineMemo || l.memo || cleanMemo).slice(0, 255),
      });
    }
    totalD = round2(totalD);
    totalC = round2(totalC);
    if (totalD <= 0 && totalC <= 0) {
      throw httpError(400, "Transaction amount must be a positive number.");
    }
    if (Math.abs(totalD - totalC) >= 0.005) {
      throw httpError(
        400,
        `Double-entry parity violation: total debits (${totalD.toFixed(2)}) and credits (${totalC.toFixed(2)}) do not balance.`
      );
    }
  } else {
    const cleanDebitCode = String(debitAccountCode || "").trim();
    const cleanCreditCode = String(creditAccountCode || "").trim();
    if (!cleanDebitCode || !cleanCreditCode) {
      throw httpError(400, "Both debitAccountCode and creditAccountCode are required.");
    }
    if (cleanDebitCode === cleanCreditCode) {
      throw httpError(400, "Debit and Credit accounts must be different.");
    }

    if (debitAmount !== undefined && creditAmount !== undefined) {
      const dAmt = parseExactMoney(debitAmount, "Debit amount");
      const cAmt = parseExactMoney(creditAmount, "Credit amount");
      if (Math.abs(dAmt - cAmt) >= 0.005) {
        throw httpError(
          400,
          `Double-entry parity violation: debit amount (${dAmt.toFixed(2)}) and credit amount (${cAmt.toFixed(2)}) do not balance.`
        );
      }
    }

    const rawTarget = amount !== undefined ? amount : (debitAmount !== undefined ? debitAmount : creditAmount);
    const cleanAmount = parseExactMoney(rawTarget, "Transaction amount");

    finalLines = [
      { accountCode: cleanDebitCode, debit: cleanAmount, credit: 0.00, lineMemo: `Debit ${cleanDebitCode}` },
      { accountCode: cleanCreditCode, debit: 0.00, credit: cleanAmount, lineMemo: `Credit ${cleanCreditCode}` },
    ];
  }

  if (finalLines.some((l) => l.accountCode === "6030")) {
    throw httpError(400, "Waste cost is worked out from your inventory waste records, so it can't be entered by hand.");
  }
  if (finalLines.some((l) => l.accountCode === "2020")) {
    throw httpError(400, "VAT collected is recorded automatically from orders, so it can't be entered by hand.");
  }
  if (finalLines.some((l) => PAYROLL_EXPENSE_ACCOUNT_CODES.includes(l.accountCode))) {
    throw httpError(400, PAYROLL_ONLY_MESSAGE);
  }
  if (finalLines.some((l) => PAYROLL_LIABILITY_ACCOUNT_CODES.includes(l.accountCode))) {
    throw httpError(
      400,
      "Payroll payables (2040, 2045, 2050, 2060) are posted only by Payroll Runs and settled from the Payables list.",
    );
  }
  if (
    finalLines.some((l) => l.accountCode === "2010" || l.accountCode === "2030") &&
    !["operating_expense", "income_tax", "ap_settlement"].includes(entryType)
  ) {
    throw httpError(
      400,
      "Accounts 2010 and 2030 are tracked subledger liabilities and may only be posted via operating_expense, income_tax, or ap_settlement entries.",
    );
  }

  const totalAmount = round2(finalLines.reduce((s, l) => s + l.debit, 0));
  const accountCodes = [...new Set(finalLines.map((l) => l.accountCode))];
  const debitLines = finalLines.filter((l) => l.debit > 0);
  const creditLines = finalLines.filter((l) => l.credit > 0);

  if (cleanClientRequestId) {
    const [[existing]] = await pool.execute(
      "SELECT id FROM journal_entries WHERE idempotency_key = ? LIMIT 1",
      [cleanClientRequestId],
    );
    if (existing) {
      const storedAmount = await assertJournalReplayMatches(pool, Number(existing.id), entryType, finalLines);
      return response.status(200).json({
        message: "Journal entry already recorded (idempotent replay).",
        entryId: Number(existing.id),
        amount: storedAmount,
      });
    }
  }

  const [accRows] = await pool.query(
    `SELECT id, account_code, account_category, report_section, is_active
       FROM chart_of_accounts
      WHERE is_active = TRUE
        AND account_code IN (${accountCodes.map(() => "?").join(",")})`,
    accountCodes,
  );
  const coaMap = new Map(accRows.map((r) => [r.account_code, r]));

  for (const l of finalLines) {
    if (!coaMap.has(l.accountCode)) {
      throw httpError(400, `Account code '${l.accountCode}' is inactive or not found in Chart of Accounts.`);
    }
  }

  const connection = await pool.getConnection();
  let txOpen = false;
  let postedEntryId;
  const warnings = [];

  try {
    await connection.beginTransaction();
    txOpen = true;

    const touchesDepreciationAccounts = finalLines.some((l) => l.accountCode === "6210" || l.accountCode === "1520");
    if (entryType === "depreciation" || touchesDepreciationAccounts) {
      if (entryType !== "depreciation") {
        throw httpError(400, "Equipment wear and tear can only be recorded as a depreciation entry.");
      }
      if (finalLines.some((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode))) {
        throw httpError(400, "Equipment wear and tear is not a cash payment, so it can't involve the cash drawer, GCash, the store bank or the owner reserve.");
      }
      if (!debitLines.every((l) => l.accountCode === "6210") || !creditLines.every((l) => l.accountCode === "1520")) {
        throw httpError(400, "A depreciation entry must add to equipment wear and tear and reduce the equipment's value.");
      }

      await connection.execute(
        "SELECT id FROM chart_of_accounts WHERE account_code IN ('1510', '1520') ORDER BY account_code ASC FOR UPDATE",
      );
      const [[equipAgg]] = await connection.execute(
        `SELECT COALESCE(SUM(CASE WHEN coa.account_code = '1510' THEN jel.debit - jel.credit ELSE 0 END), 0.00) AS bal_1510,
                COALESCE(SUM(CASE WHEN coa.account_code = '1520' THEN jel.credit - jel.debit ELSE 0 END), 0.00) AS bal_1520
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE coa.account_code IN ('1510', '1520')`,
      );
      const bal1510 = round2(equipAgg?.bal_1510 || 0);
      const bal1520 = round2(equipAgg?.bal_1520 || 0);
      const netBookValue = round2(bal1510 - bal1520);
      if (totalAmount > netBookValue + 0.001) {
        throw httpError(
          409,
          `Depreciation amount (₱${totalAmount.toFixed(2)}) exceeds remaining Equipment Net Book Value (₱${netBookValue.toFixed(2)}).`,
        );
      }
    } else if (entryType === "operating_expense") {
      if (!debitLines.every((l) => EXPENSE_REPORT_SECTIONS.includes(coaMap.get(l.accountCode)?.report_section))) {
        throw httpError(400, "Operating expense debits must target active OPEX or occupancy accounts.");
      }
      if (cleanExpenseCategory && !debitLines.every((line) => cleanExpenseCategory.accountCodes.includes(line.accountCode))) {
        throw httpError(400, "The selected expense category does not match the expense account.");
      }
      if (!creditLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode) || l.accountCode === "2010")) {
        throw httpError(400, "Pay a running cost from the cash drawer, GCash, the store bank or the owner reserve, or save it as an unpaid bill.");
      }
      warnings.push(...await liquidShortfallWarnings(connection, creditLines));
    } else if (entryType === "income_tax") {
      if (!debitLines.every((l) => l.accountCode === "6310")) {
        throw httpError(400, "An income tax entry must be recorded as an income tax cost.");
      }
      if (!creditLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode) || l.accountCode === "2030")) {
        throw httpError(400, "Pay income tax from the cash drawer, GCash, the store bank or the owner reserve, or save it as income tax still owed.");
      }
      warnings.push(...await liquidShortfallWarnings(connection, creditLines));
    } else if (entryType === "ap_settlement") {
      const liabCodes = [...new Set(debitLines.map((l) => l.accountCode))];
      if (liabCodes.length !== 1 || !["2010", "2030"].includes(liabCodes[0])) {
        throw httpError(400, "A payment of what you owe must pay off unpaid supplier bills or income tax owed, one at a time.");
      }
      if (!creditLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode))) {
        throw httpError(400, "Pay what you owe from the cash drawer, GCash, the store bank or the owner reserve.");
      }
      warnings.push(...await liquidShortfallWarnings(connection, creditLines));
      const targetLiability = liabCodes[0];
      // Lock parent COA row and open payables; avoid scanning/locking historical journal_entry_lines rows.
      await connection.execute(
        "SELECT id FROM chart_of_accounts WHERE account_code = ? AND is_active = TRUE ORDER BY account_code ASC FOR UPDATE",
        [targetLiability],
      );
      const [trackedRows] = await connection.execute(
        `SELECT original_amount, paid_amount
           FROM financial_payables
          WHERE liability_account_code = ?
            AND status IN ('unpaid', 'partial')
          ORDER BY id ASC
          FOR UPDATE`,
        [targetLiability],
      );
      const [[glAgg]] = await connection.execute(
        `SELECT COALESCE(SUM(jel.credit - jel.debit), 0.00) AS gl_balance
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE coa.account_code = ?`,
        [targetLiability],
      );
      const glBalance = round2(glAgg?.gl_balance || 0);
      const trackedOpen = round2(
        trackedRows.reduce((s, r) => s + Number(r.original_amount || 0) - Number(r.paid_amount || 0), 0),
      );
      const untrackedBalance = round2(Math.max(0, glBalance - trackedOpen));
      if (totalAmount > untrackedBalance + 0.001) {
        throw httpError(409, "Tracked unpaid bills must be settled via POST /api/finances/payables/:id/settle.");
      }
    } else if (entryType === "owner_withdrawal") {
      if (!debitLines.every((l) => l.accountCode === "3020") || !creditLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode))) {
        throw httpError(400, "An owner withdrawal must come out of the cash drawer, GCash, the store bank or the owner reserve.");
      }
      await assertLiquidFunds(connection, creditLines, "withdraw");
    } else if (entryType === "capital_injection") {
      if (!debitLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode)) || !creditLines.every((l) => l.accountCode === "3010")) {
        throw httpError(400, "Money the owner puts in must go into the cash drawer, GCash, the store bank or the owner reserve.");
      }
    } else if (entryType === "account_transfer") {
      if (!finalLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode))) {
        throw httpError(400, "Transfers can only be made between the cash drawer, GCash, the store bank or the owner reserve.");
      }
      await assertLiquidFunds(connection, creditLines, "transfer");
    }

    const touchesDrawer = entryType !== "opening_balance" && finalLines.some((l) => l.accountCode === "1010");
    const explicitSessionId = request.body?.sessionId ?? null;
    const sessionId = touchesDrawer
      ? await resolveActiveSessionId(connection, request.authUser.sub, { explicitSessionId })
      : null;

    const ledgerRes = await postBalancedEntry(connection, {
      entryType,
      memo: cleanMemo,
      referenceNumber: referenceNumber ? String(referenceNumber).slice(0, 100) : null,
      sessionId,
      idempotencyKey: cleanClientRequestId,
      entryDate: cleanEntryDate,
      createdBy: request.authUser.sub,
      lines: finalLines,
    });
    if (ledgerRes.skipped) {
      await connection.rollback();
      txOpen = false;
      const storedAmount = ledgerRes.entryId
        ? await assertJournalReplayMatches(connection, Number(ledgerRes.entryId), entryType, finalLines)
        : totalAmount;
      return response.status(200).json({
        message: "Journal entry already recorded (idempotent replay).",
        entryId: ledgerRes.entryId,
        amount: storedAmount,
      });
    }
    postedEntryId = ledgerRes.entryId;

    if (cleanExpenseCategory && postedEntryId) {
      await connection.execute(
        `UPDATE journal_entries je JOIN expense_categories ec ON ec.slug = ?
            SET je.expense_category_id = ec.id WHERE je.id = ?`,
        [cleanExpenseCategory.slug, postedEntryId],
      );
    }

    if (postedEntryId) {
      if (entryType === "operating_expense") {
        const apCredit = round2(creditLines.filter((l) => l.accountCode === "2010").reduce((s, l) => s + l.credit, 0));
        if (apCredit > 0) {
          await connection.execute(
            `INSERT INTO financial_payables (
               bill_number, bill_category, vendor_name, expense_account_code, liability_account_code,
               bill_date, due_date, original_amount, paid_amount, status, incurred_journal_entry_id,
               session_id, notes, created_by
             ) VALUES (?, 'opex', ?, ?, '2010', ?, ?, ?, 0.00, 'unpaid', ?, ?, ?, ?)`,
            [
              `BILL-${postedEntryId}`,
              cleanVendorName,
              debitLines[0].accountCode,
              cleanEntryDate ? cleanEntryDate.slice(0, 10) : getManilaDateString(),
              cleanDueDate,
              apCredit,
              postedEntryId,
              sessionId,
              cleanMemo,
              request.authUser.sub,
            ],
          );
        }
      } else if (entryType === "income_tax") {
        const taxCredit = round2(creditLines.filter((l) => l.accountCode === "2030").reduce((s, l) => s + l.credit, 0));
        if (taxCredit > 0) {
          await connection.execute(
            `INSERT INTO financial_payables (
               bill_number, bill_category, vendor_name, expense_account_code, liability_account_code,
               bill_date, due_date, original_amount, paid_amount, status, incurred_journal_entry_id,
               session_id, notes, created_by
             ) VALUES (?, 'income_tax', ?, '6310', '2030', ?, ?, ?, 0.00, 'unpaid', ?, ?, ?, ?)`,
            [
              `TAX-${postedEntryId}`,
              cleanVendorName || "BIR / Tax Authority",
              getManilaDateString(),
              cleanDueDate,
              taxCredit,
              postedEntryId,
              sessionId,
              cleanMemo,
              request.authUser.sub,
            ],
          );
        }
      }
    }

    await connection.commit();
    txOpen = false;
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }

  response.status(201).json({
    message: "Journal entry posted successfully with balanced debit and credit.",
    entryId: postedEntryId,
    amount: totalAmount,
    warnings,
  });
});

// -------------------------------------------------------------
// 5B. PAYABLES SUBLEDGER & SETTLEMENT (2010 AP & 2030 TAX PAYABLE)
// -------------------------------------------------------------
router.get("/payables", requireAuth, requireRole("admin"), async (request, response) => {
  const rawStatus = request.query?.status !== undefined ? String(request.query.status).trim().toLowerCase() : "open";
  const rawCategory = request.query?.category !== undefined ? String(request.query.category).trim().toLowerCase() : "";

  const validStatuses = new Set(["open", "all", "unpaid", "partial", "paid", "voided"]);
  if (!validStatuses.has(rawStatus)) {
    throw httpError(400, "Invalid status filter. Allowed: open, all, unpaid, partial, paid, voided.");
  }
  const validCategories = new Set(["", "opex", "inventory_restock", "income_tax", "payroll", "statutory"]);
  if (!validCategories.has(rawCategory)) {
    throw httpError(400, "Invalid category filter. Allowed: opex, inventory_restock, income_tax.");
  }

  const conditions = [];
  const params = [];
  if (rawStatus === "open") {
    conditions.push("fp.status IN ('unpaid', 'partial')");
  } else if (rawStatus !== "all") {
    conditions.push("fp.status = ?");
    params.push(rawStatus);
  }
  if (rawCategory) {
    conditions.push("fp.bill_category = ?");
    params.push(rawCategory);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = Math.max(1, Number.parseInt(request.query?.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(request.query?.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const [[countRow], [rows], [[totalsRow]], [glRows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS total FROM financial_payables fp ${whereClause}`, params),
    pool.query(
      `SELECT fp.*
         FROM financial_payables fp
         ${whereClause}
        ORDER BY FIELD(fp.status, 'unpaid', 'partial', 'paid', 'voided'), COALESCE(fp.due_date, fp.bill_date) ASC, fp.id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    pool.query(
      `SELECT COALESCE(SUM(CASE WHEN liability_account_code = '2010' AND status IN ('unpaid', 'partial') THEN original_amount - paid_amount ELSE 0 END), 0.00) AS unpaid_ap_2010,
              COALESCE(SUM(CASE WHEN liability_account_code = '2030' AND status IN ('unpaid', 'partial') THEN original_amount - paid_amount ELSE 0 END), 0.00) AS unpaid_tax_2030
         FROM financial_payables`,
    ),
    pool.query(
      `SELECT account_code, COALESCE(current_balance, 0.00) AS balance
         FROM view_account_balances
        WHERE account_code IN ('2010', '2030')`,
    ),
  ]);
  const glMap = new Map(glRows.map((r) => [r.account_code, round2(r.balance)]));

  response.json({
    items: rows.map((r) => ({
      id: Number(r.id),
      billNumber: r.bill_number,
      billCategory: r.bill_category,
      vendorName: r.vendor_name || null,
      expenseAccountCode: r.expense_account_code,
      liabilityAccountCode: r.liability_account_code,
      billDate: formatDbDateOnly(r.bill_date),
      dueDate: formatDbDateOnly(r.due_date),
      originalAmount: round2(r.original_amount),
      paidAmount: round2(r.paid_amount),
      remainingAmount: round2(Number(r.original_amount) - Number(r.paid_amount)),
      status: r.status,
      incurredJournalEntryId: Number(r.incurred_journal_entry_id),
      sessionId: r.session_id ? Number(r.session_id) : null,
      notes: r.notes || "",
    })),
    total: Number(countRow?.[0]?.total ?? rows.length),
    page,
    limit,
    totals: {
      unpaidAp2010: round2(totalsRow?.unpaid_ap_2010 || 0),
      unpaidTax2030: round2(totalsRow?.unpaid_tax_2030 || 0),
      glAp2010Balance: glMap.get("2010") || 0.00,
      glTax2030Balance: glMap.get("2030") || 0.00,
    },
  });
});

router.post("/payables/:id/settle", requireAuth, requireRole("admin"), async (request, response) => {
  const payableId = Number(request.params.id);
  if (!Number.isSafeInteger(payableId) || payableId <= 0) {
    throw httpError(400, "Invalid payable ID.");
  }

  const paymentAccountCode = String(request.body?.paymentAccountCode || "").trim();
  if (!LIQUID_ACCOUNT_CODES.has(paymentAccountCode)) {
    throw httpError(400, "Choose where the payment came from: the cash drawer, GCash, the store bank or the owner reserve.");
  }
  const amount = parseExactMoney(request.body?.amount, "Settlement amount");
  if (request.body?.notes !== undefined && request.body?.notes !== null && typeof request.body.notes !== "string") {
    throw httpError(400, "Settlement notes must be a string.");
  }
  const cleanNotes = request.body?.notes ? String(request.body.notes).trim().slice(0, 255) : "";
  const cleanClientRequestId = parseOptionalClientRequestId(request.body?.clientRequestId);

  const [[payableMeta]] = await pool.execute(
    "SELECT id, liability_account_code FROM financial_payables WHERE id = ? LIMIT 1",
    [payableId],
  );
  if (!payableMeta) {
    throw httpError(404, "Payable record not found.");
  }

  const connection = await pool.getConnection();
  let txOpen = false;
  let resultPayload;

  try {
    await connection.beginTransaction();
    txOpen = true;

    // Deterministic lock hierarchy matching POST /journal-entries:
    // chart_of_accounts (sorted ascending) -> financial_payables -> journal_entry_lines
    const lockCodes = [...new Set([payableMeta.liability_account_code, paymentAccountCode])].sort();
    const [lockedCoaRows] = await connection.execute(
      `SELECT id, account_code
         FROM chart_of_accounts
        WHERE account_code IN (${lockCodes.map(() => "?").join(",")})
          AND is_active = TRUE
        ORDER BY account_code ASC
        FOR UPDATE`,
      lockCodes,
    );
    const liabCoa = lockedCoaRows.find((r) => r.account_code === payableMeta.liability_account_code);
    if (!liabCoa) {
      throw httpError(400, `Liability account '${payableMeta.liability_account_code}' is inactive or missing.`);
    }

    const [[payable]] = await connection.execute(
      "SELECT * FROM financial_payables WHERE id = ? FOR UPDATE",
      [payableId],
    );
    if (!payable) {
      throw httpError(404, "Payable record not found.");
    }

    const expectedSettleLines = [
      {
        accountCode: payable.liability_account_code,
        debit: amount,
        credit: 0,
        lineMemo: `Settle ${payable.bill_number}`,
      },
      {
        accountCode: paymentAccountCode,
        debit: 0,
        credit: amount,
        lineMemo: `Paid ${payable.bill_number} from ${paymentAccountCode}`,
      },
    ];

    if (cleanClientRequestId) {
      const [[existingJe]] = await connection.execute(
        "SELECT id, payable_id FROM journal_entries WHERE idempotency_key = ? LIMIT 1",
        [cleanClientRequestId],
      );
      if (existingJe) {
        if (Number(existingJe.payable_id) !== payableId) {
          throw httpError(409, "Client request ID was already used for a different payable settlement.");
        }
        await connection.rollback();
        txOpen = false;
        await assertJournalReplayMatches(connection, Number(existingJe.id), "ap_settlement", expectedSettleLines);
        return response.status(200).json({
          message: "Payable settlement already recorded (idempotent replay).",
          entryId: Number(existingJe.id),
          payableId: Number(payable.id),
          billNumber: payable.bill_number,
          paidAmount: Number(payable.paid_amount),
          remainingAmount: round2(Math.max(0, Number(payable.original_amount) - Number(payable.paid_amount))),
          status: payable.status,
        });
      }
    }

    if (payable.bill_category === "payroll") {
      throw httpError(409, "Staff net pay is paid from Expenses and Payroll → Payroll Runs, one payslip per employee.");
    }
    if (payable.status === "paid" || payable.status === "voided") {
      throw httpError(409, `Payable ${payable.bill_number} is already '${payable.status}' and cannot be settled.`);
    }

    const remaining = round2(Number(payable.original_amount) - Number(payable.paid_amount));
    if (amount > remaining + 0.001) {
      throw httpError(
        409,
        `Settlement amount (₱${amount.toFixed(2)}) exceeds remaining payable balance (₱${remaining.toFixed(2)}).`,
      );
    }

    const [[glAgg]] = await connection.execute(
      `SELECT COALESCE(SUM(credit - debit), 0.00) AS live_gl_balance
         FROM journal_entry_lines
        WHERE account_id = ?`,
      [liabCoa.id],
    );
    const liveGlBalance = round2(glAgg?.live_gl_balance || 0);
    if (amount > liveGlBalance + 0.001) {
      throw httpError(
        409,
        `Settlement amount (₱${amount.toFixed(2)}) exceeds live GL liability balance (₱${liveGlBalance.toFixed(2)}).`,
      );
    }

    const settleWarnings = await liquidShortfallWarnings(connection, expectedSettleLines);

    const explicitSessionId = request.body?.sessionId ?? null;
    const sessionId = paymentAccountCode === "1010"
      ? await resolveActiveSessionId(connection, request.authUser.sub, { explicitSessionId })
      : null;

    const jeRes = await postBalancedEntry(connection, {
      entryType: "ap_settlement",
      memo: cleanNotes || `Settlement of ${payable.bill_number}${payable.vendor_name ? ` (${payable.vendor_name})` : ""}`,
      referenceNumber: payable.bill_number,
      sessionId,
      payableId: payable.id,
      idempotencyKey: cleanClientRequestId,
      createdBy: request.authUser.sub,
      lines: expectedSettleLines,
    });

    if (jeRes.skipped) {
      await connection.rollback();
      txOpen = false;
      if (jeRes.entryId) {
        const [[dupHeader]] = await connection.execute(
          "SELECT payable_id FROM journal_entries WHERE id = ? LIMIT 1",
          [jeRes.entryId],
        );
        if (Number(dupHeader?.payable_id) !== payableId) {
          throw httpError(409, "Client request ID was already used for a different payable settlement.");
        }
        await assertJournalReplayMatches(connection, Number(jeRes.entryId), "ap_settlement", expectedSettleLines);
      }
      return response.status(200).json({
        message: "Payable settlement already recorded (idempotent replay).",
        entryId: jeRes.entryId,
        payableId: Number(payable.id),
        billNumber: payable.bill_number,
        paidAmount: Number(payable.paid_amount),
        remainingAmount: round2(Math.max(0, Number(payable.original_amount) - Number(payable.paid_amount))),
        status: payable.status,
      });
    }

    const newPaid = round2(Number(payable.paid_amount) + amount);
    const newRemaining = round2(Math.max(0, Number(payable.original_amount) - newPaid));
    const newStatus = newRemaining < 0.005 ? "paid" : "partial";

    await connection.execute(
      "UPDATE financial_payables SET paid_amount = ?, status = ? WHERE id = ?",
      [newPaid, newStatus, payable.id],
    );

    await connection.commit();
    txOpen = false;
    resultPayload = {
      message: "Payable settled successfully.",
      entryId: jeRes.entryId,
      payableId: Number(payable.id),
      billNumber: payable.bill_number,
      paidAmount: newPaid,
      remainingAmount: newRemaining,
      status: newStatus,
      warnings: settleWarnings,
    };
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }

  response.status(201).json(resultPayload);
});

// -------------------------------------------------------------
// 6. TRACEABLE JOURNAL REVERSAL (Admin Only)
// -------------------------------------------------------------
router.post("/journal-entries/:id/reverse", requireAuth, requireRole("admin"), async (request, response) => {
  const targetId = Number(request.params.id);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    throw httpError(400, "Invalid journal entry ID.");
  }
  const reason = String(request.body?.reason ?? "").trim().slice(0, 255);

  const connection = await pool.getConnection();
  let reversalEntryId;
  try {
    await connection.beginTransaction();

    const [[originalEntry]] = await connection.execute(
      "SELECT * FROM journal_entries WHERE id = ? FOR UPDATE",
      [targetId]
    );
    if (!originalEntry) throw httpError(404, "Original journal entry not found.");
    if (originalEntry.is_reversal) {
      throw httpError(400, "Cannot reverse an entry that is already a reversal.");
    }
    if (originalEntry.inventory_movement_id != null) {
      throw httpError(409, "Reverse inventory-backed entries via Inventory endpoints so stock quantities stay synchronized.");
    }
    if (originalEntry.order_id != null) {
      throw httpError(409, "Reverse order-backed entries via Order Void or Item Revert so order status and stock stay synchronized.");
    }
    if (await findPayrollOwnerOfEntry(connection, targetId)) {
      throw httpError(409, "This entry belongs to a payroll run. Undo it from Expenses and Payroll → Payroll Runs so payslips stay correct.");
    }
    const [[utilityPart]] = await connection.execute(
      "SELECT bill_id FROM utility_bill_parts WHERE journal_entry_id = ? LIMIT 1",
      [targetId],
    );
    if (utilityPart) {
      throw httpError(409, `This entry is part of utility bill #${utilityPart.bill_id}. Void the whole bill from its utility page so every month stays correct.`);
    }

    const [[existingReversal]] = await connection.execute(
      "SELECT id FROM journal_entries WHERE reverses_entry_id = ? LIMIT 1 FOR UPDATE",
      [targetId]
    );
    if (existingReversal) {
      throw httpError(409, "This journal entry has already been reversed.");
    }

    const [lines] = await connection.execute(
      `SELECT jel.*, coa.account_code
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id = ?`,
      [targetId]
    );
    if (!lines || lines.length === 0) {
      throw httpError(400, "Original journal entry contains no lines to reverse.");
    }
    // Checked after the "belongs to payroll / order / inventory" rules so those clearer messages win.
    if (reason.length < 3) {
      throw httpError(400, "Please give an audit reason of at least 3 characters for this reversal.");
    }

    // Undoing money that came in (capital, a transfer's destination) takes it back out, so the
    // account must still hold it.
    await assertLiquidFunds(
      connection,
      lines.map((l) => ({ accountCode: l.account_code, credit: l.debit })),
      "reverse",
    );

    const [[incurredPayable]] = await connection.execute(
      "SELECT * FROM financial_payables WHERE incurred_journal_entry_id = ? LIMIT 1 FOR UPDATE",
      [targetId],
    );
    if (incurredPayable && incurredPayable.status !== "voided") {
      if (Number(incurredPayable.paid_amount || 0) > 0) {
        throw httpError(409, "Cannot reverse bill/payable with active settlements. Reverse its settlements first.");
      }
      await connection.execute(
        "UPDATE financial_payables SET status = 'voided' WHERE id = ?",
        [incurredPayable.id],
      );
    }

    if (originalEntry.entry_type === "ap_settlement" && originalEntry.payable_id != null) {
      const [[settledPayable]] = await connection.execute(
        "SELECT * FROM financial_payables WHERE id = ? LIMIT 1 FOR UPDATE",
        [originalEntry.payable_id],
      );
      if (settledPayable) {
        const settledAmount = round2(
          lines
            .filter((l) => l.account_code === settledPayable.liability_account_code)
            .reduce((sum, l) => sum + Number(l.debit || 0), 0),
        );
        const newPaid = round2(Math.max(0, Number(settledPayable.paid_amount || 0) - settledAmount));
        const newStatus = newPaid <= 0
          ? "unpaid"
          : (Math.abs(Number(settledPayable.original_amount) - newPaid) < 0.005 ? "paid" : "partial");
        await connection.execute(
          "UPDATE financial_payables SET paid_amount = ?, status = ? WHERE id = ?",
          [newPaid, newStatus, settledPayable.id],
        );
      }
    }

    const reversalNumber = generateEntryNumber("REV");
    const reversalMemo = `Reversal of ${originalEntry.entry_number}: ${reason}`.slice(0, 255);
    let revHeader;
    try {
      [revHeader] = await connection.execute(
        `INSERT INTO journal_entries (entry_number, entry_type, memo, session_id, is_reversal, reverses_entry_id, created_by)
         VALUES (?, 'void_reversal', ?, ?, TRUE, ?, ?)`,
        [reversalNumber, reversalMemo, originalEntry.session_id ?? null, targetId, request.authUser.sub]
      );
    } catch (insertError) {
      if (insertError?.code === "ER_DUP_ENTRY") {
        throw httpError(409, "This journal entry has already been reversed.");
      }
      throw insertError;
    }
    reversalEntryId = revHeader.insertId;

    // Flip debits and credits
    for (const l of lines) {
      const reversedDebit = round2(l.credit);
      const reversedCredit = round2(l.debit);
      await connection.execute(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo)
         VALUES (?, ?, ?, ?, ?)`,
        [reversalEntryId, l.account_id, reversedDebit, reversedCredit, `Reversing line #${l.id}`]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  response.status(201).json({
    message: "Traceable reversal entry created successfully. Historical entry preserved.",
    reversalEntryId,
    originalEntryId: targetId,
  });
});

// -------------------------------------------------------------
// 6B. MONTH CLOSE (Admin + Net Income PIN)
// A closed month accepts no new postings dated inside it (see assertPeriodOpen). Corrections
// are made in the current month with a linked reversal.
// -------------------------------------------------------------
function parsePeriodMonth(value) {
  const month = String(value || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw httpError(400, "Month must use YYYY-MM format.");
  return month;
}

function periodBounds(month) {
  const start = `${month}-01 00:00:00`;
  const next = new Date(`${month}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: `${next.toISOString().slice(0, 10)} 00:00:00` };
}

/** What stops a month from being closed: shifts still open and entries whose debits and credits differ. */
async function loadPeriodChecklist(executor, month) {
  const { start, end } = periodBounds(month);
  const [[shiftRow]] = await executor.query(
    "SELECT COUNT(*) AS open_shifts FROM cashier_sessions WHERE status = 'open' AND opened_at < ?",
    [end],
  );
  const [[unbalancedRow]] = await executor.query(
    `SELECT COUNT(*) AS unbalanced FROM (
       SELECT je.id
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
        WHERE je.entry_date >= ? AND je.entry_date < ?
        GROUP BY je.id
       HAVING ABS(SUM(jel.debit) - SUM(jel.credit)) >= 0.005
     ) bad`,
    [start, end],
  );
  const [[countRow]] = await executor.query(
    "SELECT COUNT(*) AS entries FROM journal_entries WHERE entry_date >= ? AND entry_date < ?",
    [start, end],
  );
  const openShifts = Number(shiftRow?.open_shifts || 0);
  const unbalancedEntries = Number(unbalancedRow?.unbalanced || 0);
  const problems = [];
  if (openShifts > 0) problems.push(`${openShifts} cashier shift${openShifts === 1 ? " is" : "s are"} still open. Close ${openShifts === 1 ? "it" : "them"} first.`);
  if (unbalancedEntries > 0) problems.push(`${unbalancedEntries} entr${unbalancedEntries === 1 ? "y does" : "ies do"} not balance. Ask your developer or accountant to check ${unbalancedEntries === 1 ? "it" : "them"}.`);
  return { openShifts, unbalancedEntries, entryCount: Number(countRow?.entries || 0), problems, canClose: problems.length === 0 };
}

router.get("/periods", requireAuth, requireRole("admin"), async (_request, response) => {
  const currentMonth = manilaMonthOf(new Date());
  let closures = [];
  try {
    [closures] = await pool.query(
      `SELECT pc.period_month, pc.closed_at, pc.close_note, pc.reopened_at, pc.reopen_reason,
              COALESCE(cu.display_name, cu.username) AS closed_by_name
         FROM period_closures pc
         LEFT JOIN users cu ON cu.id = pc.closed_by`,
    );
  } catch (error) {
    if (Number(error?.errno) !== 1146) throw error;
  }
  const byMonth = new Map(closures.map((row) => [row.period_month, row]));
  const months = [];
  let cursor = new Date(`${currentMonth}-01T00:00:00Z`);
  for (let i = 0; i < 12; i += 1) {
    const month = cursor.toISOString().slice(0, 7);
    const closure = byMonth.get(month);
    const isClosed = Boolean(closure && !closure.reopened_at);
    const isCurrent = month === currentMonth;
    months.push({
      month,
      status: isClosed ? "closed" : isCurrent ? "current" : "open",
      closedAt: isClosed ? closure.closed_at : null,
      closedBy: isClosed ? closure.closed_by_name || null : null,
      closeNote: isClosed ? closure.close_note || null : null,
      lastReopenReason: closure?.reopened_at ? closure.reopen_reason || null : null,
      checklist: isClosed || isCurrent ? null : await loadPeriodChecklist(pool, month),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  response.json({ currentMonth, months });
});

router.post("/periods/:month/close", requireAuth, requireRole("admin"), async (request, response) => {
  if (!hasValidNetIncomeAccess(request)) {
    throw httpError(403, "Enter the Net Income PIN to close a month.");
  }
  const month = parsePeriodMonth(request.params.month);
  if (month >= manilaMonthOf(new Date())) {
    throw httpError(409, "Only a month that has fully ended can be closed.");
  }
  const note = String(request.body?.note ?? "").trim().slice(0, 255) || null;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.query(
      "SELECT id, reopened_at FROM period_closures WHERE period_month = ? FOR UPDATE",
      [month],
    );
    if (existing && !existing.reopened_at) throw httpError(409, `${month} is already closed.`);
    const checklist = await loadPeriodChecklist(connection, month);
    if (!checklist.canClose) throw httpError(409, `${month} cannot be closed yet. ${checklist.problems.join(" ")}`);
    if (existing) {
      await connection.execute(
        `UPDATE period_closures
            SET closed_by = ?, closed_at = NOW(), close_note = ?, reopened_by = NULL, reopened_at = NULL, reopen_reason = NULL
          WHERE id = ?`,
        [request.authUser.sub, note, existing.id],
      );
    } else {
      await connection.execute(
        "INSERT INTO period_closures (period_month, closed_by, close_note) VALUES (?, ?, ?)",
        [month, request.authUser.sub, note],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  response.status(201).json({ message: `${month} is now closed.`, month });
});

router.post("/periods/:month/reopen", requireAuth, requireRole("admin"), async (request, response) => {
  if (!hasValidNetIncomeAccess(request)) {
    throw httpError(403, "Enter the Net Income PIN to reopen a month.");
  }
  const month = parsePeriodMonth(request.params.month);
  const reason = String(request.body?.reason ?? "").trim().slice(0, 255);
  if (reason.length < 3) throw httpError(400, "Please say why you are reopening this month (at least 3 characters).");
  const [result] = await pool.execute(
    `UPDATE period_closures
        SET reopened_by = ?, reopened_at = NOW(), reopen_reason = ?
      WHERE period_month = ? AND reopened_at IS NULL`,
    [request.authUser.sub, reason, month],
  );
  if (!result.affectedRows) throw httpError(409, `${month} is not closed.`);
  response.json({ message: `${month} is open again.`, month });
});

// -------------------------------------------------------------
// 7. FORMAL PROFIT & LOSS (P&L) STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/profit-and-loss", requireAuth, requireRole("admin"), async (request, response) => {
  const report = await getProfitAndLossReport(request.query?.from, request.query?.to);
  if (!hasValidNetIncomeAccess(request)) return response.json(lockProfitAndLossReport(report));
  // Utility bills not in yet: estimated and shown beside the P&L, never posted (D7).
  report.utilityEstimates = await loadUtilityEstimatesForRange(request.query?.from || null, request.query?.to || null);
  response.json(report);
});

// -------------------------------------------------------------
// 8. CASH FLOW STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/cash-flow", requireAuth, requireRole("admin"), async (request, response) => {
  const report = await getCashFlowReport(request.query?.from, request.query?.to);
  // Payroll totals are private (D6): the payroll line hides without the PIN; OPEX paid stays.
  if (!hasValidNetIncomeAccess(request)) report.operatingActivities.payrollCashOutflow = null;
  response.json(report);
});

// -------------------------------------------------------------
// 9. DAILY STORE ASSET RECONCILIATION LEDGER (Admin Only)
// -------------------------------------------------------------
router.get("/reports/daily-reconciliation", requireAuth, requireRole("admin"), async (request, response) => {
  const report = await getDailyReconciliationReport(request.query || {});
  if (!hasValidNetIncomeAccess(request)) {
    report.items = report.items.map((item) => ({ ...item, cogsConsumed: null, netOperatingProfit: null }));
    report.profitLocked = true;
  }
  response.json(report);
});

// -------------------------------------------------------------
// 9B. CASH DRAWER LIMITS AND HISTORY BY CASHIER AND WEEKDAY (Admin Only)
// Limits only flag shifts for review; nothing here is ever deducted from anyone's pay.
// -------------------------------------------------------------
async function loadDrawerThresholds(executor = pool) {
  try {
    const [[row]] = await executor.query("SELECT drawer_variance_ok, drawer_variance_review FROM business_settings WHERE id = 1 LIMIT 1");
    return normalizeDrawerThresholds(row?.drawer_variance_ok, row?.drawer_variance_review);
  } catch (error) {
    if (Number(error?.errno) === 1054) return { ...DRAWER_DEFAULTS };
    throw error;
  }
}

router.get("/drawer-thresholds", requireAuth, requireRole("admin"), async (_request, response) => {
  response.json(await loadDrawerThresholds());
});

router.put("/drawer-thresholds", requireAuth, requireRole("admin"), async (request, response) => {
  if (!hasValidNetIncomeAccess(request)) {
    throw httpError(403, "Enter the Net Income PIN to change the drawer limits.");
  }
  const checked = validateDrawerThresholds(request.body?.ok, request.body?.review);
  if (checked.error) throw httpError(400, checked.error);
  const [result] = await pool.execute(
    "UPDATE business_settings SET drawer_variance_ok = ?, drawer_variance_review = ? WHERE id = 1",
    [checked.ok, checked.review],
  );
  if (!result.affectedRows) throw httpError(503, "Business settings are unavailable.");
  response.json({ ok: checked.ok, review: checked.review });
});

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

router.get("/reports/drawer-history", requireAuth, requireRole("admin"), async (request, response) => {
  const { from, to } = assertValidDateRange(request.query?.from, request.query?.to);
  const thresholds = await loadDrawerThresholds();
  // Without dates, look at the last 90 days so one old bad week does not follow someone forever.
  let rangeFrom = from;
  if (!from && !to) {
    const start = new Date(`${getManilaDateString()}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 90);
    rangeFrom = start.toISOString().slice(0, 10);
  }
  const conditions = ["status = 'closed'", "variance IS NOT NULL", "closed_at IS NOT NULL"];
  const params = [thresholds.ok];
  if (rangeFrom) {
    conditions.push("closed_at >= ?");
    params.push(`${rangeFrom} 00:00:00`);
  }
  if (to) {
    conditions.push("closed_at <= ?");
    params.push(`${to} 23:59:59`);
  }
  const [rows] = await pool.query(
    `SELECT user_id, MAX(cashier_name_snapshot) AS cashier_name, DAYOFWEEK(closed_at) AS weekday,
            COUNT(*) AS shifts,
            COALESCE(SUM(variance), 0) AS net_variance,
            COALESCE(SUM(ABS(variance)), 0) AS total_difference,
            COALESCE(SUM(ABS(variance) > ?), 0) AS flagged_shifts
       FROM cashier_sessions
      WHERE ${conditions.join(" AND ")}
      GROUP BY user_id, DAYOFWEEK(closed_at)
      ORDER BY cashier_name ASC, weekday ASC`,
    params,
  );
  const items = rows.map((row) => {
    const shifts = Number(row.shifts);
    const flaggedShifts = Number(row.flagged_shifts);
    return {
      userId: Number(row.user_id),
      cashierName: row.cashier_name,
      weekday: WEEKDAY_NAMES[Number(row.weekday) - 1] || String(row.weekday),
      weekdayNumber: Number(row.weekday),
      shifts,
      flaggedShifts,
      netVariance: round2(row.net_variance),
      averageDifference: shifts ? round2(Number(row.total_difference) / shifts) : 0,
      isPattern: isDrawerPattern(shifts, flaggedShifts),
    };
  });
  response.json({ from: rangeFrom, to: to || null, thresholds, items, patternCount: items.filter((item) => item.isPattern).length });
});

// -------------------------------------------------------------
// 10. BALANCE SHEET STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/balance-sheet", requireAuth, requireRole("admin"), async (request, response) => {
  const report = await getBalanceSheetReport(request.query?.asOf);
  response.json(hasValidNetIncomeAccess(request) ? report : lockBalanceSheetReport(report));
});

export default router;
