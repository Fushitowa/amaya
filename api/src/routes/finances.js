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
} from "../utils/ledgerService.js";
import { parseOptionalClientRequestId } from "../utils/validation.js";
import { LIQUID_ACCOUNT_CODES } from "../utils/coaConstants.js";
import { formatDbDateOnly } from "../../../shared/manilaDate.js";
import { EXPENSE_NAV_CATEGORIES, getExpenseNavCategory } from "../../../shared/expenseNavigation.js";
import {
  getAccountsAndAssetsReport,
  getBalanceSheetReport,
  getCashFlowReport,
  getDailyReconciliationReport,
  getProfitAndLossReport,
  getTrialBalanceReport,
} from "../services/financesReportService.js";

const router = Router();

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

function hasValidNetIncomeAccess(request) {
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
  const [spentRows] = await pool.execute(
    `SELECT coa.account_code, ec.slug AS category_slug, COALESCE(SUM(jel.debit), 0.00) AS spent
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       LEFT JOIN expense_categories ec ON ec.id = je.expense_category_id
      WHERE je.entry_type = 'operating_expense'
        AND je.is_reversal = FALSE
        AND je.entry_date >= ? AND je.entry_date < ?
        AND coa.report_section = 'opex'
        AND coa.account_code IN (${allCodes.map(() => "?").join(",")})
        AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reverses_entry_id = je.id)
      GROUP BY coa.account_code, ec.slug`,
    [`${monthStart} 00:00:00`, `${monthEndExclusive} 00:00:00`, ...allCodes],
  );
  const spentByCode = new Map();
  const spentByCategory = new Map();
  for (const row of spentRows) {
    if (row.category_slug) spentByCategory.set(row.category_slug, (spentByCategory.get(row.category_slug) || 0) + Number(row.spent || 0));
    else spentByCode.set(String(row.account_code), Number(row.spent || 0));
  }
  const budgetBySlug = new Map(budgetRows.map((row) => [row.slug, row]));
  return EXPENSE_NAV_CATEGORIES.map((category) => {
    const row = budgetBySlug.get(category.slug);
    const legacySpent = category.accountCodes.reduce((sum, code) => sum + (spentByCode.get(code) || 0), 0);
    const spent = Math.round(((spentByCategory.get(category.slug) || 0) + legacySpent) * 100) / 100;
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
    };
  });
}

router.get("/expense-budgets/health", requireAuth, async (request, response) => {
  const health = await getExpenseBudgetHealth(request.query?.month);
  response.json({ month: budgetMonth(request.query?.month), items: health });
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

router.post("/expense-records", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const category = getExpenseNavCategory(request.body?.category);
  if (!category) throw httpError(400, "Choose a valid expense category.");
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
const LOCKED_SUMMARY_KEYS = [
  "netIncome", "netProfitAfterSale", "allTimeNetProfit", "baseCapitalMoney",
  "grossProfit", "grossMarginPercent", "cogs", "customerSalesCogs", "foodSpoilageCogs", "wasteCost",
  "operatingExpenses", "totalOperatingExpenses", "depreciation", "tax", "totalCogsAndExpenses",
];
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
  const { type, from, to, page, limit, accountCodes, expenseCategory } = request.query || {};
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
    conditions.push(`(je.expense_category_id = (SELECT ec.id FROM expense_categories ec WHERE ec.slug = ?)
      OR (je.expense_category_id IS NULL AND EXISTS (
        SELECT 1 FROM journal_entry_lines jel_expense_filter
        JOIN chart_of_accounts coa_expense_filter ON coa_expense_filter.id = jel_expense_filter.account_id
        WHERE jel_expense_filter.journal_entry_id = je.id AND jel_expense_filter.debit > 0
          AND coa_expense_filter.report_section = 'opex'
          AND coa_expense_filter.account_code IN (${category.accountCodes.map(() => "?").join(",")})
      )))`);
    params.push(category.slug, ...category.accountCodes);
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
         AND coa_expense_filter.report_section = 'opex'
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
              coa.account_category
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
      lines: entryLines,
    };
  });

  response.json({
    items,
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
    throw httpError(400, "Waste Cost (6030) is calculated from inventory waste records and cannot be entered as a manual journal amount.");
  }
  if (finalLines.some((l) => l.accountCode === "2020")) {
    throw httpError(400, "Account 2020 (Sales Tax / VAT Payable) is reserved strictly for automated POS order transactions.");
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

  try {
    await connection.beginTransaction();
    txOpen = true;

    const touchesDepreciationAccounts = finalLines.some((l) => l.accountCode === "6210" || l.accountCode === "1520");
    if (entryType === "depreciation" || touchesDepreciationAccounts) {
      if (entryType !== "depreciation") {
        throw httpError(400, "Depreciation accounts (6210 / 1520) may only be posted with entryType 'depreciation'.");
      }
      if (finalLines.some((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode))) {
        throw httpError(400, "Depreciation is strictly non-cash and cannot touch liquid accounts (1010–1040).");
      }
      if (!debitLines.every((l) => l.accountCode === "6210") || !creditLines.every((l) => l.accountCode === "1520")) {
        throw httpError(400, "Depreciation entries must strictly debit 6210 and credit 1520.");
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
      if (!debitLines.every((l) => coaMap.get(l.accountCode)?.report_section === "opex")) {
        throw httpError(400, "Operating expense debits must target active OPEX accounts.");
      }
      if (cleanExpenseCategory && !debitLines.every((line) => cleanExpenseCategory.accountCodes.includes(line.accountCode))) {
        throw httpError(400, "The selected expense category does not match the expense account.");
      }
      if (!creditLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode) || l.accountCode === "2010")) {
        throw httpError(400, "Operating expenses must be paid via 1010–1040 or accrued to 2010 Accounts Payable.");
      }
    } else if (entryType === "income_tax") {
      if (!debitLines.every((l) => l.accountCode === "6310")) {
        throw httpError(400, "Income tax entries must debit 6310 Income Tax Expense.");
      }
      if (!creditLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode) || l.accountCode === "2030")) {
        throw httpError(400, "Income tax must be paid via 1010–1040 or accrued to 2030 Income Tax Payable.");
      }
    } else if (entryType === "ap_settlement") {
      const liabCodes = [...new Set(debitLines.map((l) => l.accountCode))];
      if (liabCodes.length !== 1 || !["2010", "2030"].includes(liabCodes[0])) {
        throw httpError(400, "Manual ap_settlement must debit a single payable account (2010 or 2030).");
      }
      if (!creditLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode))) {
        throw httpError(400, "Payable settlements must credit a liquid account (1010–1040).");
      }
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
        throw httpError(400, "Owner withdrawals must debit 3020 and credit a liquid account (1010–1040).");
      }
      const uniqueLiquidCodes = [...new Set(creditLines.map((l) => l.accountCode))].sort();
      if (uniqueLiquidCodes.length > 0) {
        await connection.execute(
          `SELECT id FROM chart_of_accounts WHERE account_code IN (${uniqueLiquidCodes.map(() => "?").join(",")}) ORDER BY account_code ASC FOR UPDATE`,
          uniqueLiquidCodes,
        );
      }
      for (const accountCode of uniqueLiquidCodes) {
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
          const unconfirmedCash = round2(Math.max(0, Number(unconfirmedRow?.unconfirmed_counter_cash || 0)));
          availableBalance = round2(availableBalance - unconfirmedCash);
        }
        const creditToAccount = round2(
          creditLines
            .filter((l) => l.accountCode === accountCode)
            .reduce((sum, l) => sum + Number(l.credit || 0), 0),
        );
        if (creditToAccount > availableBalance + 0.001) {
          throw httpError(
            409,
            `Insufficient confirmed funds in account ${accountCode}: trying to withdraw ₱${creditToAccount.toFixed(2)}, but available confirmed balance is ₱${Math.max(0, availableBalance).toFixed(2)}.`,
          );
        }
      }
    } else if (entryType === "capital_injection") {
      if (!debitLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode)) || !creditLines.every((l) => l.accountCode === "3010")) {
        throw httpError(400, "Capital injections must debit a liquid account (1010–1040) and credit 3010.");
      }
    } else if (entryType === "account_transfer") {
      if (!finalLines.every((l) => LIQUID_ACCOUNT_CODES.has(l.accountCode))) {
        throw httpError(400, "Liquid account transfers must strictly use accounts 1010–1040.");
      }
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
              getManilaDateString(),
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
  const validCategories = new Set(["", "opex", "inventory_restock", "income_tax"]);
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
    throw httpError(400, "Invalid paymentAccountCode. Must be a liquid account (1010–1040).");
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
  const reason = String(request.body?.reason || "Audited transaction reversal").trim().slice(0, 255);

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
// 7. FORMAL PROFIT & LOSS (P&L) STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/profit-and-loss", requireAuth, requireRole("admin"), async (request, response) => {
  const report = await getProfitAndLossReport(request.query?.from, request.query?.to);
  response.json(hasValidNetIncomeAccess(request) ? report : lockProfitAndLossReport(report));
});

// -------------------------------------------------------------
// 8. CASH FLOW STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/cash-flow", requireAuth, requireRole("admin"), async (request, response) => {
  response.json(await getCashFlowReport(request.query?.from, request.query?.to));
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
// 10. BALANCE SHEET STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/balance-sheet", requireAuth, requireRole("admin"), async (request, response) => {
  const report = await getBalanceSheetReport();
  response.json(hasValidNetIncomeAccess(request) ? report : lockBalanceSheetReport(report));
});

export default router;
