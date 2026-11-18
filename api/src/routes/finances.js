import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import {
  round2,
  generateEntryNumber,
  getManilaDateString,
  assertValidDateRange,
  parseBoundedPositiveInt,
  summarizeIncomeStatementLines,
  postBalancedEntry,
  parseExactMoney,
  resolveActiveSessionId,
  isValidIsoDateOnly,
} from "../utils/ledgerService.js";

const router = Router();
const CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9:_-]{16,96}$/;
const LIQUID_ACCOUNT_CODES = new Set(["1010", "1020", "1030", "1040"]);

function parseOptionalClientRequestId(rawValue) {
  const hasField = rawValue !== undefined && rawValue !== null && String(rawValue) !== "";
  if (!hasField) return null;
  if (typeof rawValue !== "string") {
    throw httpError(400, "Invalid clientRequestId format.");
  }
  const trimmed = rawValue.trim();
  if (!CLIENT_REQUEST_ID_REGEX.test(trimmed)) {
    throw httpError(400, "Invalid clientRequestId format.");
  }
  return trimmed;
}

function parseOptionalOpeningAmount(rawValue, label) {
  if (rawValue === undefined || rawValue === null) return 0;
  if (typeof rawValue === "string" && rawValue.trim() === "") return 0;
  return parseExactMoney(rawValue, label, { allowZero: true });
}

function formatDbDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  }
  return String(value).slice(0, 10);
}

const BS_LABELS = {
  "1010": "Cash Drawer (Counter 1)",
  "1020": "GCash Official Wallet",
  "1030": "Store Bank Account",
  "1040": "Owner Capital Reserve",
  "1050": "Merchandise Inventory (Ledger)",
  "1510": "Kitchen & Espresso Equipment",
  "1520": "Less: Accumulated Depreciation",
  "2010": "Accounts Payable (Suppliers)",
  "2020": "2020 - Sales Tax / VAT Payable (Collected on Orders)",
  "2030": "Income Tax Payable",
};

function summarizeBalanceSheetAccounts(accounts = []) {
  const accountMap = new Map();
  const currentAssets = [];
  const nonCurrentAssets = [];
  const currentLiabilities = [];

  let totalCurrentAssets = 0;
  let grossEquipment = 0;
  let accumulatedDepreciation = 0;
  let netEquipment = 0;
  let totalLiabilities = 0;

  for (const acc of accounts) {
    const code = String(acc.account_code);
    const bal = round2(acc.current_balance);
    accountMap.set(code, bal);
    if (acc.report_section !== "balance_sheet") continue;

    if (acc.account_category === "asset") {
      const isContra = String(acc.normal_balance).toLowerCase() === "credit";
      const signed = isContra ? -bal : bal;
      if (LIQUID_ACCOUNT_CODES.has(code) || code === "1050") {
        currentAssets.push({
          accountCode: code,
          accountName: BS_LABELS[code] || acc.account_name,
          amount: bal,
        });
        totalCurrentAssets += signed;
      } else {
        nonCurrentAssets.push({
          accountCode: code,
          accountName: BS_LABELS[code] || acc.account_name,
          amount: bal,
          ...(isContra ? { isContra: true } : {}),
        });
        if (isContra) accumulatedDepreciation += bal;
        else grossEquipment += bal;
        netEquipment += signed;
      }
    } else if (acc.account_category === "liability") {
      const isCreditNormal = String(acc.normal_balance).toLowerCase() === "credit";
      const signed = isCreditNormal ? bal : -bal;
      currentLiabilities.push({
        accountCode: code,
        accountName: BS_LABELS[code] || acc.account_name,
        amount: signed,
      });
      totalLiabilities += signed;
    }
  }

  const roundedGrossEquip = round2(grossEquipment);
  const roundedAccumDepr = round2(accumulatedDepreciation);
  const roundedNetEquip = round2(netEquipment);
  const roundedTotalCurrent = round2(totalCurrentAssets);

  return {
    accountMap,
    currentAssets,
    nonCurrentAssets,
    grossEquipment: roundedGrossEquip,
    accumulatedDepreciation: roundedAccumDepr,
    netEquipment: roundedNetEquip,
    totalAssets: round2(roundedTotalCurrent + roundedNetEquip),
    currentLiabilities,
    totalLiabilities: round2(totalLiabilities),
    ownerCapital: accountMap.get("3010") || 0.00,
    ownerDrawings: accountMap.get("3020") || 0.00,
  };
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
router.all(["/accounts", "/accounts/:id"], (request, response, next) => {
  if (["PUT", "PATCH", "DELETE", "POST"].includes(request.method)) {
    return response.status(405).json({
      message: "Account balances are strictly derived from journal ledger entries and cannot be directly modified.",
    });
  }
  next();
});

router.all("/journal-entries/:id", (request, response, next) => {
  if (["PUT", "PATCH", "DELETE"].includes(request.method)) {
    return response.status(405).json({
      message: "Financial records are strictly immutable. Journal entries cannot be edited or deleted; corrections must be posted as traceable reversals via POST /api/finances/journal-entries/:id/reverse.",
    });
  }
  next();
});

router.get("/trial-balance", requireAuth, requireRole("admin"), async (_request, response) => {
  const [rows] = await pool.query(
    `SELECT coa.id,
            coa.account_code,
            coa.account_name,
            coa.account_category,
            coa.normal_balance,
            coa.report_section,
            coa.expense_group,
            COALESCE(v.total_debits, 0.00) AS total_debits,
            COALESCE(v.total_credits, 0.00) AS total_credits,
            COALESCE(v.current_balance, 0.00) AS current_balance
       FROM chart_of_accounts coa
       LEFT JOIN view_account_balances v ON v.id = coa.id
      WHERE coa.is_active = TRUE
      ORDER BY coa.account_code ASC`
  );

  let totalDebits = 0;
  let totalCredits = 0;
  for (const row of rows) {
    totalDebits += Number(row.total_debits || 0);
    totalCredits += Number(row.total_credits || 0);
  }

  const roundedDebits = round2(totalDebits);
  const roundedCredits = round2(totalCredits);
  const isBalanced = Math.abs(roundedDebits - roundedCredits) < 0.005;

  response.json({
    accounts: rows.map((r) => ({
      id: Number(r.id),
      accountCode: r.account_code,
      accountName: r.account_name,
      category: r.account_category,
      normalBalance: r.normal_balance,
      reportSection: r.report_section,
      expenseGroup: r.expense_group || null,
      totalDebits: round2(r.total_debits),
      totalCredits: round2(r.total_credits),
      currentBalance: round2(r.current_balance),
    })),
    totalDebits: roundedDebits,
    totalCredits: roundedCredits,
    isBalanced,
  });
});

// -------------------------------------------------------------
// 2. ACCOUNTS & STORE TOTAL ASSETS OVERVIEW (Admin Only)
// -------------------------------------------------------------
router.get("/accounts", requireAuth, requireRole("admin"), async (_request, response) => {
  const [accounts] = await pool.query(
    `SELECT coa.id,
            coa.account_code,
            coa.account_name,
            coa.account_category,
            coa.normal_balance,
            coa.report_section,
            coa.expense_group,
            COALESCE(v.total_debits, 0.00) AS total_debits,
            COALESCE(v.total_credits, 0.00) AS total_credits,
            COALESCE(v.current_balance, 0.00) AS current_balance
       FROM chart_of_accounts coa
       LEFT JOIN view_account_balances v ON v.id = coa.id
      WHERE coa.is_active = TRUE
      ORDER BY coa.account_code ASC`
  );

  // Live ingredient inventory valuation directly from active stock
  const [[invRow]] = await pool.query(
    "SELECT COALESCE(SUM(quantity * unit_cost), 0.00) AS live_inventory_value FROM inventory_items WHERE is_archived = FALSE"
  );
  const liveInventoryValue = round2(invRow?.live_inventory_value);

  const bs = summarizeBalanceSheetAccounts(accounts);
  const cashDrawer = bs.accountMap.get("1010") || 0.00;
  const gcash = bs.accountMap.get("1020") || 0.00;
  const bank = bs.accountMap.get("1030") || 0.00;
  const reserve = bs.accountMap.get("1040") || 0.00;
  const nonCurrentEquipment = bs.netEquipment;

  const totalLiquidAssets = round2(cashDrawer + gcash + bank + reserve);
  const totalStoreAssets = round2(totalLiquidAssets + liveInventoryValue + nonCurrentEquipment);
  const totalLiabilities = bs.totalLiabilities;
  const ownerCapital = bs.ownerCapital;
  const ownerDrawings = bs.ownerDrawings;

  const pnl = summarizeIncomeStatementLines(accounts, { clampSections: false });
  const netSalesRevenue = pnl.netSales;
  const totalCogsAndExpenses = round2(pnl.cogs + pnl.totalOperatingExpenses + pnl.depreciation + pnl.tax);
  const netProfitAfterSale = pnl.netIncome;
  const baseCapitalMoney = round2(totalStoreAssets - netProfitAfterSale);

  response.json({
    accounts: accounts.map((a) => ({
      id: Number(a.id),
      accountCode: a.account_code,
      accountName: a.account_name,
      category: a.account_category,
      normalBalance: a.normal_balance,
      reportSection: a.report_section,
      expenseGroup: a.expense_group || null,
      balance: round2(a.current_balance),
    })),
    summary: {
      cashDrawer,
      gcash,
      bank,
      reserve,
      totalLiquidAssets,
      liveInventoryValue,
      nonCurrentEquipment,
      totalStoreAssets,
      totalLiabilities,
      ownerCapital,
      ownerDrawings,
      baseCapitalMoney,
      netProfitAfterSale,
      netSalesRevenue,
      totalCogsAndExpenses,
    },
  });
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
  const { type, from, to, page, limit } = request.query || {};
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
        "SELECT id FROM chart_of_accounts WHERE account_code IN ('1510', '1520') FOR UPDATE",
      );
      const [equipLines] = await connection.execute(
        `SELECT coa.account_code, jel.debit, jel.credit
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE coa.account_code IN ('1510', '1520')
          FOR UPDATE`,
      );
      let bal1510 = 0;
      let bal1520 = 0;
      for (const row of equipLines) {
        const d = Number(row.debit || 0);
        const c = Number(row.credit || 0);
        if (row.account_code === "1510") bal1510 += d - c;
        else if (row.account_code === "1520") bal1520 += c - d;
      }
      bal1510 = round2(bal1510);
      bal1520 = round2(bal1520);
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
      await connection.execute(
        "SELECT id FROM chart_of_accounts WHERE account_code = ? AND is_active = TRUE FOR UPDATE",
        [targetLiability],
      );
      const [glLines] = await connection.execute(
        `SELECT jel.credit, jel.debit
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE coa.account_code = ?
          FOR UPDATE`,
        [targetLiability],
      );
      const glBalance = round2(glLines.reduce((s, r) => s + Number(r.credit || 0) - Number(r.debit || 0), 0));
      const [trackedRows] = await connection.execute(
        `SELECT original_amount, paid_amount
           FROM financial_payables
          WHERE liability_account_code = ?
            AND status IN ('unpaid', 'partial')
          FOR UPDATE`,
        [targetLiability],
      );
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
    const sessionId = touchesDrawer ? await resolveActiveSessionId(connection, request.authUser.sub) : null;

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

  const [rows] = await pool.query(
    `SELECT fp.*
       FROM financial_payables fp
       ${whereClause}
      ORDER BY FIELD(fp.status, 'unpaid', 'partial', 'paid', 'voided'), COALESCE(fp.due_date, fp.bill_date) ASC, fp.id DESC`,
    params,
  );

  const [[totalsRow]] = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN liability_account_code = '2010' AND status IN ('unpaid', 'partial') THEN original_amount - paid_amount ELSE 0 END), 0.00) AS unpaid_ap_2010,
            COALESCE(SUM(CASE WHEN liability_account_code = '2030' AND status IN ('unpaid', 'partial') THEN original_amount - paid_amount ELSE 0 END), 0.00) AS unpaid_tax_2030
       FROM financial_payables`,
  );

  const [glRows] = await pool.query(
    `SELECT account_code, COALESCE(current_balance, 0.00) AS balance
       FROM view_account_balances
      WHERE account_code IN ('2010', '2030')`,
  );
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

  const connection = await pool.getConnection();
  let txOpen = false;
  let resultPayload;

  try {
    await connection.beginTransaction();
    txOpen = true;

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

    const [[liabCoa]] = await connection.execute(
      "SELECT id FROM chart_of_accounts WHERE account_code = ? AND is_active = TRUE FOR UPDATE",
      [payable.liability_account_code],
    );
    if (!liabCoa) {
      throw httpError(400, `Liability account '${payable.liability_account_code}' is inactive or missing.`);
    }

    const [glLines] = await connection.execute(
      `SELECT credit, debit
         FROM journal_entry_lines
        WHERE account_id = ?
        FOR UPDATE`,
      [liabCoa.id],
    );
    const liveGlBalance = round2(glLines.reduce((s, r) => s + Number(r.credit || 0) - Number(r.debit || 0), 0));
    if (amount > liveGlBalance + 0.001) {
      throw httpError(
        409,
        `Settlement amount (₱${amount.toFixed(2)}) exceeds live GL liability balance (₱${liveGlBalance.toFixed(2)}).`,
      );
    }

    const sessionId = paymentAccountCode === "1010"
      ? await resolveActiveSessionId(connection, request.authUser.sub)
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
  const { from: rawFrom, to: rawTo } = request.query || {};
  const { from, to } = assertValidDateRange(rawFrom, rawTo);
  const conditions = [];
  const params = [];

  if (from) {
    conditions.push("je.entry_date >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push("je.entry_date <= ?");
    params.push(`${to} 23:59:59`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [lines] = await pool.query(
    `SELECT coa.account_code,
            coa.account_name,
            coa.account_category,
            coa.normal_balance,
            coa.report_section,
            coa.expense_group,
            COALESCE(SUM(jel.debit), 0.00) AS total_debit,
            COALESCE(SUM(jel.credit), 0.00) AS total_credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       ${whereClause}
      GROUP BY coa.account_code, coa.account_name, coa.account_category, coa.normal_balance, coa.report_section, coa.expense_group`,
    params
  );

  const pnl = summarizeIncomeStatementLines(lines);

  response.json({
    grossSales: pnl.grossSales,
    discounts: pnl.discounts,
    netSales: pnl.netSales,
    customerSalesCogs: pnl.customerSalesCogs,
    foodSpoilageCogs: pnl.foodSpoilageCogs,
    cogs: pnl.cogs,
    grossProfit: pnl.grossProfit,
    grossMarginPercent: pnl.grossMarginPercent,
    operatingExpenses: pnl.operatingExpenses,
    totalOperatingExpenses: pnl.totalOperatingExpenses,
    depreciation: pnl.depreciation,
    tax: pnl.tax,
    ebitdaOperatingIncome: pnl.ebitdaOperatingIncome,
    netIncomeBeforeTax: pnl.netIncomeBeforeTax,
    netIncome: pnl.netIncome,
    netOperatingProfit: pnl.netOperatingProfit,
  });
});

// -------------------------------------------------------------
// 8. CASH FLOW STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/cash-flow", requireAuth, requireRole("admin"), async (request, response) => {
  const { from: rawFrom, to: rawTo } = request.query || {};
  const { from, to } = assertValidDateRange(rawFrom, rawTo);
  const conditions = [
    `EXISTS (
      SELECT 1
        FROM journal_entry_lines jel_liq
        JOIN chart_of_accounts coa_liq ON coa_liq.id = jel_liq.account_id
       WHERE jel_liq.journal_entry_id = je.id
         AND coa_liq.account_code IN ('1010', '1020', '1030', '1040')
    )`,
  ];
  const params = [];

  if (from) {
    conditions.push("je.entry_date >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push("je.entry_date <= ?");
    params.push(`${to} 23:59:59`);
  }
  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const [rows] = await pool.query(
    `SELECT je.id AS entry_id,
            je.entry_type,
            parent_je.entry_type AS parent_entry_type,
            fp.bill_category AS payable_bill_category,
            coa.account_code,
            jel.debit,
            jel.credit
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       LEFT JOIN journal_entries parent_je ON parent_je.id = je.reverses_entry_id
       LEFT JOIN financial_payables fp ON fp.id = COALESCE(je.payable_id, parent_je.payable_id)
       ${whereClause}
      ORDER BY je.id ASC, jel.id ASC`,
    params,
  );

  const byEntry = new Map();
  for (const r of rows) {
    const entryId = Number(r.entry_id);
    let bucket = byEntry.get(entryId);
    if (!bucket) {
      bucket = {
        entryType: r.entry_type,
        parentEntryType: r.parent_entry_type || null,
        payableBillCategory: r.payable_bill_category || null,
        liquidNet: 0,
        counterpartCodes: new Set(),
      };
      byEntry.set(entryId, bucket);
    }
    const code = String(r.account_code);
    const debit = Number(r.debit || 0);
    const credit = Number(r.credit || 0);
    if (LIQUID_ACCOUNT_CODES.has(code)) {
      bucket.liquidNet += (debit - credit);
    } else {
      bucket.counterpartCodes.add(code);
    }
  }

  let cashSalesInflow = 0;
  let opexCashOutflow = 0;
  let restockCashOutflow = 0;
  let taxCashOutflow = 0;
  let otherOperatingCashNet = 0;
  let investingNet = 0;
  let capitalInflow = 0;
  let drawingOutflow = 0;

  for (const entry of byEntry.values()) {
    const liquidNet = round2(entry.liquidNet);
    if (Math.abs(liquidNet) < 0.005) continue;

    const effectiveType = entry.entryType === "void_reversal" && entry.parentEntryType
      ? entry.parentEntryType
      : entry.entryType;
    const counterparts = entry.counterpartCodes;

    if (
      effectiveType !== "opening_balance" &&
      counterparts.has("1510") &&
      !counterparts.has("1050") &&
      !counterparts.has("3010") &&
      !counterparts.has("3020")
    ) {
      investingNet += liquidNet;
    } else if (effectiveType === "capital_injection" || effectiveType === "opening_balance") {
      capitalInflow += liquidNet;
    } else if (effectiveType === "owner_withdrawal") {
      drawingOutflow += (-liquidNet);
    } else if (effectiveType === "sales_revenue") {
      cashSalesInflow += liquidNet;
    } else if (effectiveType === "operating_expense") {
      opexCashOutflow += (-liquidNet);
    } else if (effectiveType === "inventory_restock") {
      restockCashOutflow += (-liquidNet);
    } else if (effectiveType === "income_tax") {
      taxCashOutflow += (-liquidNet);
    } else if (effectiveType === "ap_settlement") {
      if (entry.payableBillCategory === "inventory_restock") {
        restockCashOutflow += (-liquidNet);
      } else if (entry.payableBillCategory === "income_tax" || (!entry.payableBillCategory && counterparts.has("2030"))) {
        taxCashOutflow += (-liquidNet);
      } else {
        opexCashOutflow += (-liquidNet);
      }
    } else if (
      counterparts.has("3010") &&
      !counterparts.has("1050") &&
      !counterparts.has("4010") &&
      !counterparts.has("5010")
    ) {
      capitalInflow += liquidNet;
    } else if (
      counterparts.has("3020") &&
      !counterparts.has("1050") &&
      !counterparts.has("4010") &&
      !counterparts.has("5010")
    ) {
      drawingOutflow += (-liquidNet);
    } else if (
      (counterparts.has("2030") || counterparts.has("6310")) &&
      !counterparts.has("4010") &&
      !counterparts.has("5010")
    ) {
      taxCashOutflow += (-liquidNet);
    } else {
      otherOperatingCashNet += liquidNet;
    }
  }

  const operatingCashFlow = round2(
    cashSalesInflow + otherOperatingCashNet - (opexCashOutflow + restockCashOutflow + taxCashOutflow),
  );
  const equipmentPurchased = round2(-investingNet);
  const investingCashFlow = round2(investingNet);
  const financingCashFlow = round2(capitalInflow - drawingOutflow);
  const netCashFlow = round2(operatingCashFlow + investingCashFlow + financingCashFlow);

  response.json({
    operatingActivities: {
      cashSalesInflow: round2(cashSalesInflow),
      otherOperatingCashNet: round2(otherOperatingCashNet),
      opexCashOutflow: round2(opexCashOutflow),
      restockCashOutflow: round2(restockCashOutflow),
      taxCashOutflow: round2(taxCashOutflow),
      netOperatingCashFlow: operatingCashFlow,
    },
    investingActivities: {
      equipmentPurchased,
      netInvestingCashFlow: investingCashFlow,
    },
    financingActivities: {
      capitalInjected: round2(capitalInflow),
      drawingsWithdrawn: round2(drawingOutflow),
      netFinancingCashFlow: financingCashFlow,
    },
    netCashFlow,
  });
});

// -------------------------------------------------------------
// 9. DAILY STORE ASSET RECONCILIATION LEDGER (Admin Only)
// -------------------------------------------------------------
router.get("/reports/daily-reconciliation", requireAuth, requireRole("admin"), async (request, response) => {
  const { from: rawFrom, to: rawTo, page, limit } = request.query || {};
  const { from, to } = assertValidDateRange(rawFrom, rawTo);
  const numPage = parseBoundedPositiveInt(page, 1, 1, 100_000, "Page");
  const numLimit = parseBoundedPositiveInt(limit, 25, 1, 100, "Limit");
  const offset = (numPage - 1) * numLimit;

  const conditions = [];
  const params = [];

  if (from) {
    conditions.push("snap.business_date >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("snap.business_date <= ?");
    params.push(to);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM store_daily_asset_snapshots snap ${whereClause}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT snap.*,
            DATE_FORMAT(snap.business_date, '%Y-%m-%d') AS business_date_formatted,
            COALESCE(u1.display_name, u1.username) AS opened_by_name,
            COALESCE(u2.display_name, u2.username) AS closed_by_name
       FROM store_daily_asset_snapshots snap
       LEFT JOIN users u1 ON u1.id = snap.opened_by
       LEFT JOIN users u2 ON u2.id = snap.closed_by
       ${whereClause}
      ORDER BY snap.business_date DESC
      LIMIT ? OFFSET ?`,
    [...params, numLimit, offset]
  );

  response.json({
    items: rows.map((r) => ({
      id: Number(r.id),
      businessDate: r.business_date_formatted || (r.business_date instanceof Date ? r.business_date.toLocaleDateString("en-CA") : String(r.business_date).slice(0, 10)),
      status: r.status,
      openingLiquidAssets: round2(r.opening_liquid_assets),
      openingInventoryValue: round2(r.opening_inventory_value),
      openingNonCurrentAssets: round2(r.opening_non_current_assets),
      openingTotalAssets: round2(r.opening_total_assets),
      closingLiquidAssets: r.closing_liquid_assets != null ? round2(r.closing_liquid_assets) : null,
      closingInventoryValue: r.closing_inventory_value != null ? round2(r.closing_inventory_value) : null,
      closingNonCurrentAssets: r.closing_non_current_assets != null ? round2(r.closing_non_current_assets) : null,
      closingTotalAssets: r.closing_total_assets != null ? round2(r.closing_total_assets) : null,
      grossSales: round2(r.gross_sales),
      discountsGranted: round2(r.discounts_granted),
      netSales: round2(r.net_sales),
      cogsConsumed: round2(r.cogs_consumed),
      grossProfit: round2(r.gross_profit),
      operatingExpenses: round2(r.operating_expenses),
      netOperatingProfit: round2(r.net_operating_profit),
      capitalInjections: round2(r.capital_injections),
      ownerWithdrawals: round2(r.owner_withdrawals),
      drawerVariance: round2(r.drawer_variance),
      spoilageShrinkage: round2(r.spoilage_shrinkage),
      netAssetDelta: r.net_asset_delta != null ? round2(r.net_asset_delta) : null,
      openedByName: r.opened_by_name,
      closedByName: r.closed_by_name,
    })),
    total: Number(countRow?.total || 0),
    page: numPage,
    limit: numLimit,
  });
});

// -------------------------------------------------------------
// 10. BALANCE SHEET STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/balance-sheet", requireAuth, requireRole("admin"), async (_request, response) => {
  const [accounts] = await pool.query(
    `SELECT coa.id,
            coa.account_code,
            coa.account_name,
            coa.account_category,
            coa.normal_balance,
            coa.report_section,
            coa.expense_group,
            COALESCE(v.total_debits, 0.00) AS total_debits,
            COALESCE(v.total_credits, 0.00) AS total_credits,
            COALESCE(v.current_balance, 0.00) AS current_balance
       FROM chart_of_accounts coa
       LEFT JOIN view_account_balances v ON v.id = coa.id
      WHERE coa.is_active = TRUE
      ORDER BY coa.account_code ASC`
  );

  const [[invRow]] = await pool.query(
    "SELECT COALESCE(SUM(quantity * unit_cost), 0.00) AS live_inventory_value FROM inventory_items WHERE is_archived = FALSE"
  );
  const liveInventoryValue = round2(invRow?.live_inventory_value);

  const bs = summarizeBalanceSheetAccounts(accounts);
  const ledgerInventoryValue = bs.accountMap.get("1050") || 0.00;
  const inventoryValuationVariance = round2(liveInventoryValue - ledgerInventoryValue);

  // Compute true Retained Earnings directly from database-classified Income Statement accounts
  const retainedEarnings = summarizeIncomeStatementLines(accounts, { clampSections: false }).netIncome;
  const totalEquity = round2(bs.ownerCapital - bs.ownerDrawings + retainedEarnings);

  const balanceDifference = round2(bs.totalAssets - (bs.totalLiabilities + totalEquity));
  const isBalanced = Math.abs(balanceDifference) < 0.005;

  response.json({
    asOfDate: getManilaDateString(),
    assets: {
      current: bs.currentAssets,
      nonCurrent: bs.nonCurrentAssets,
      grossEquipment: bs.grossEquipment,
      accumulatedDepreciation: bs.accumulatedDepreciation,
      netEquipment: bs.netEquipment,
      totalAssets: bs.totalAssets,
    },
    grossEquipment: bs.grossEquipment,
    accumulatedDepreciation: bs.accumulatedDepreciation,
    netEquipment: bs.netEquipment,
    totalAssets: bs.totalAssets,
    ledgerInventoryValue,
    liveInventoryValue,
    inventoryValuationVariance,
    liabilities: {
      current: bs.currentLiabilities,
      totalLiabilities: bs.totalLiabilities,
    },
    totalLiabilities: bs.totalLiabilities,
    equity: {
      capital: bs.ownerCapital,
      ownerCapital: bs.ownerCapital,
      drawings: bs.ownerDrawings,
      ownerDrawings: bs.ownerDrawings,
      retainedEarnings,
      totalEquity,
    },
    totalEquity,
    balanceDifference,
    isBalanced,
  });
});

export default router;
