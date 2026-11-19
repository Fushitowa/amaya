import { Router } from "express";
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
import {
  getAccountsAndAssetsReport,
  getBalanceSheetReport,
  getCashFlowReport,
  getDailyReconciliationReport,
  getProfitAndLossReport,
  getTrialBalanceReport,
} from "../services/financesReportService.js";

const router = Router();

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

router.get("/trial-balance", requireAuth, requireRole("admin"), async (_request, response) => {
  response.json(await getTrialBalanceReport());
});

// -------------------------------------------------------------
// 2. ACCOUNTS & STORE TOTAL ASSETS OVERVIEW (Admin Only)
// -------------------------------------------------------------
router.get("/accounts", requireAuth, requireRole("admin"), async (request, response) => {
  response.json(await getAccountsAndAssetsReport(request.query?.from, request.query?.to));
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
  const { type, from, to, page, limit, accountCodes } = request.query || {};
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
  if (accountCodes !== undefined && accountCodes !== "") {
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
  response.json(await getProfitAndLossReport(request.query?.from, request.query?.to));
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
  response.json(await getDailyReconciliationReport(request.query || {}));
});

// -------------------------------------------------------------
// 10. BALANCE SHEET STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/balance-sheet", requireAuth, requireRole("admin"), async (_request, response) => {
  response.json(await getBalanceSheetReport());
});

export default router;
