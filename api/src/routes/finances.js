import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

function round2(val) {
  const num = Number(val || 0);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0.00;
}

function generateEntryNumber(type) {
  const prefix = String(type || "JE").toUpperCase().slice(0, 8);
  const rand = Math.floor(Math.random() * 100_000).toString().padStart(5, "0");
  return `JE-${prefix}-${Date.now().toString().slice(-6)}-${rand}`;
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

  const accountMap = new Map();
  for (const acc of accounts) {
    accountMap.set(acc.account_code, round2(acc.current_balance));
  }

  const cashDrawer = accountMap.get("1010") || 0.00;
  const gcash = accountMap.get("1020") || 0.00;
  const bank = accountMap.get("1030") || 0.00;
  const reserve = accountMap.get("1040") || 0.00;
  const nonCurrentEquipment = accountMap.get("1510") || 0.00;

  const totalLiquidAssets = round2(cashDrawer + gcash + bank + reserve);
  const totalStoreAssets = round2(totalLiquidAssets + liveInventoryValue + nonCurrentEquipment);

  const payables = accountMap.get("2010") || 0.00;
  const taxesPayable = accountMap.get("2020") || 0.00;
  const totalLiabilities = round2(payables + taxesPayable);

  const ownerCapital = accountMap.get("3010") || 0.00;
  const ownerDrawings = accountMap.get("3020") || 0.00;

  response.json({
    accounts: accounts.map((a) => ({
      id: Number(a.id),
      accountCode: a.account_code,
      accountName: a.account_name,
      category: a.account_category,
      normalBalance: a.normal_balance,
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
  } = request.body || {};

  const numCash = Math.max(0, Number(cashDrawer) || 0);
  const numGcash = Math.max(0, Number(gcash) || 0);
  const numBank = Math.max(0, Number(bank) || 0);
  const numReserve = Math.max(0, Number(capitalReserve) || 0);
  const numEquip = Math.max(0, Number(equipment) || 0);

  const totalOpeningDebits = round2(numCash + numGcash + numBank + numReserve + numEquip);
  if (totalOpeningDebits <= 0) {
    throw httpError(400, "Initial capital must be greater than zero across registered accounts.");
  }

  const connection = await pool.getConnection();
  let entryId;
  try {
    await connection.beginTransaction();

    const [accRows] = await connection.query(
      "SELECT id, account_code FROM chart_of_accounts WHERE account_code IN ('1010', '1020', '1030', '1040', '1510', '3010')"
    );
    const codeToId = new Map(accRows.map((r) => [r.account_code, Number(r.id)]));

    const capitalAccId = codeToId.get("3010");
    if (!capitalAccId) throw httpError(500, "Owner Capital account (3010) is not found in chart of accounts.");

    const entryNumber = generateEntryNumber("OPENING");
    const [headerResult] = await connection.execute(
      `INSERT INTO journal_entries (entry_number, entry_type, memo, created_by)
       VALUES (?, 'opening_balance', ?, ?)`,
      [entryNumber, String(notes).slice(0, 255), request.authUser.sub]
    );
    entryId = headerResult.insertId;

    const lines = [];
    if (numCash > 0 && codeToId.has("1010")) {
      lines.push([entryId, codeToId.get("1010"), round2(numCash), 0.00, "Opening Cash Drawer"]);
    }
    if (numGcash > 0 && codeToId.has("1020")) {
      lines.push([entryId, codeToId.get("1020"), round2(numGcash), 0.00, "Opening GCash Wallet"]);
    }
    if (numBank > 0 && codeToId.has("1030")) {
      lines.push([entryId, codeToId.get("1030"), round2(numBank), 0.00, "Opening Bank Account"]);
    }
    if (numReserve > 0 && codeToId.has("1040")) {
      lines.push([entryId, codeToId.get("1040"), round2(numReserve), 0.00, "Opening Capital Reserve"]);
    }
    if (numEquip > 0 && codeToId.has("1510")) {
      lines.push([entryId, codeToId.get("1510"), round2(numEquip), 0.00, "Opening Store Equipment"]);
    }

    // Balanced Credit Line: 3010 Owner's Capital
    lines.push([entryId, capitalAccId, 0.00, totalOpeningDebits, "Owner Capital Contribution"]);

    for (const line of lines) {
      await connection.execute(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo)
         VALUES (?, ?, ?, ?, ?)`,
        line
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
    message: "Initial business capital recorded successfully with balanced double entries.",
    entryId,
    totalInitialCapital: totalOpeningDebits,
  });
});

// -------------------------------------------------------------
// 4. JOURNAL ENTRIES LIST & SEARCH (Admin Only)
// -------------------------------------------------------------
router.get("/journal-entries", requireAuth, requireRole("admin"), async (request, response) => {
  const { type, from, to, page = 1, limit = 25 } = request.query || {};
  const numPage = Math.max(1, Number(page) || 1);
  const numLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const offset = (numPage - 1) * numLimit;

  const conditions = [];
  const params = [];

  if (type) {
    conditions.push("je.entry_type = ?");
    params.push(String(type).trim());
  }
  if (from) {
    conditions.push("je.entry_date >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push("je.entry_date <= ?");
    params.push(`${to} 23:59:59`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total FROM journal_entries je ${whereClause}`,
    params
  );

  const [entries] = await pool.query(
    `SELECT je.*,
            COALESCE(u.display_name, u.username) AS creator_name
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
      isReversal: Boolean(e.is_reversal),
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
  } = request.body || {};

  if (!memo || String(memo).trim().length === 0) {
    throw httpError(400, "A descriptive memo is required for audit trails.");
  }

  const validTypes = [
    "operating_expense",
    "capital_injection",
    "owner_withdrawal",
    "account_transfer",
    "adjustment",
    "inventory_restock",
    "opening_balance",
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
    for (const l of rawLines) {
      const accCode = String(l.accountCode || "").trim();
      if (!accCode) throw httpError(400, "Every journal entry line requires a valid accountCode.");
      const d = round2(Math.max(0, Number(l.debit) || 0));
      const c = round2(Math.max(0, Number(l.credit) || 0));
      totalD += d;
      totalC += c;
      finalLines.push({
        accountCode: accCode,
        debit: d,
        credit: c,
        lineMemo: String(l.lineMemo || l.memo || memo).slice(0, 255),
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
    // 2-legged entry
    if (!debitAccountCode || !creditAccountCode) {
      throw httpError(400, "Both debitAccountCode and creditAccountCode are required.");
    }
    if (debitAccountCode === creditAccountCode) {
      throw httpError(400, "Debit and Credit accounts must be different.");
    }

    if (debitAmount !== undefined && creditAmount !== undefined) {
      const dAmt = round2(Number(debitAmount));
      const cAmt = round2(Number(creditAmount));
      if (Math.abs(dAmt - cAmt) >= 0.005) {
        throw httpError(
          400,
          `Double-entry parity violation: debit amount (${dAmt.toFixed(2)}) and credit amount (${cAmt.toFixed(2)}) do not balance.`
        );
      }
    }

    const cleanAmount = round2(amount !== undefined ? amount : debitAmount);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      throw httpError(400, "Transaction amount must be a positive number.");
    }

    finalLines = [
      { accountCode: debitAccountCode, debit: cleanAmount, credit: 0.00, lineMemo: `Debit ${debitAccountCode}` },
      { accountCode: creditAccountCode, debit: 0.00, credit: cleanAmount, lineMemo: `Credit ${creditAccountCode}` },
    ];
  }

  const accountCodes = [...new Set(finalLines.map((l) => l.accountCode))];
  const connection = await pool.getConnection();
  let entryId;
  try {
    await connection.beginTransaction();

    const [accRows] = await connection.query(
      `SELECT id, account_code FROM chart_of_accounts WHERE account_code IN (${accountCodes.map(() => "?").join(",")})`,
      accountCodes
    );
    const codeMap = new Map(accRows.map((r) => [r.account_code, Number(r.id)]));

    for (const l of finalLines) {
      if (!codeMap.has(l.accountCode)) {
        throw httpError(400, `Account code '${l.accountCode}' not found in Chart of Accounts.`);
      }
    }

    const entryNumber = generateEntryNumber(entryType);
    const [headerResult] = await connection.execute(
      `INSERT INTO journal_entries (entry_number, entry_type, memo, reference_number, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [entryNumber, entryType, String(memo).slice(0, 255), referenceNumber ? String(referenceNumber).slice(0, 100) : null, request.authUser.sub]
    );
    entryId = headerResult.insertId;

    for (const line of finalLines) {
      const accId = codeMap.get(line.accountCode);
      await connection.execute(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo)
         VALUES (?, ?, ?, ?, ?)`,
        [entryId, accId, line.debit, line.credit, line.lineMemo]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const totalAmount = round2(finalLines.reduce((s, l) => s + l.debit, 0));
  response.status(201).json({
    message: "Journal entry posted successfully with balanced debit and credit.",
    entryId,
    amount: totalAmount,
  });
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

    const [lines] = await connection.execute(
      "SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?",
      [targetId]
    );
    if (!lines || lines.length === 0) {
      throw httpError(400, "Original journal entry contains no lines to reverse.");
    }

    const reversalNumber = generateEntryNumber("REV");
    const [revHeader] = await connection.execute(
      `INSERT INTO journal_entries (entry_number, entry_type, memo, is_reversal, reverses_entry_id, created_by)
       VALUES (?, 'void_reversal', ?, TRUE, ?, ?)`,
      [reversalNumber, `Reversal of ${originalEntry.entry_number}: ${reason}`, targetId, request.authUser.sub]
    );
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
  const { from, to } = request.query || {};
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
            COALESCE(SUM(jel.debit), 0.00) AS total_debit,
            COALESCE(SUM(jel.credit), 0.00) AS total_credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       ${whereClause}
      GROUP BY coa.account_code, coa.account_name, coa.account_category`
  );

  let grossSales = 0;
  let discounts = 0;
  let cogs = 0;
  const opexItems = [];
  let totalOpex = 0;

  for (const l of lines) {
    const code = l.account_code;
    const debit = Number(l.total_debit || 0);
    const credit = Number(l.total_credit || 0);

    if (code === "4010") {
      grossSales += (credit - debit);
    } else if (code === "4020") {
      discounts += (debit - credit);
    } else if (code === "5010") {
      cogs += (debit - credit);
    } else if (code.startsWith("60")) {
      const expenseAmount = round2(debit - credit);
      if (expenseAmount !== 0) {
        opexItems.push({
          accountCode: code,
          accountName: l.account_name,
          amount: expenseAmount,
        });
        totalOpex += expenseAmount;
      }
    }
  }

  const roundedGrossSales = round2(Math.max(0, grossSales));
  const roundedDiscounts = round2(Math.max(0, discounts));
  const netSales = round2(Math.max(0, roundedGrossSales - roundedDiscounts));
  const roundedCogs = round2(Math.max(0, cogs));
  const grossProfit = round2(netSales - roundedCogs);
  const grossMarginPercent = netSales > 0 ? round2((grossProfit / netSales) * 100) : 0.0;
  const roundedTotalOpex = round2(Math.max(0, totalOpex));
  const netOperatingProfit = round2(grossProfit - roundedTotalOpex);

  response.json({
    grossSales: roundedGrossSales,
    discounts: roundedDiscounts,
    netSales,
    cogs: roundedCogs,
    grossProfit,
    grossMarginPercent,
    operatingExpenses: opexItems,
    totalOperatingExpenses: roundedTotalOpex,
    netOperatingProfit,
  });
});

// -------------------------------------------------------------
// 8. CASH FLOW STATEMENT (Admin Only)
// -------------------------------------------------------------
router.get("/reports/cash-flow", requireAuth, requireRole("admin"), async (request, response) => {
  const { from, to } = request.query || {};
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
            je.entry_type,
            COALESCE(SUM(jel.debit), 0.00) AS total_debit,
            COALESCE(SUM(jel.credit), 0.00) AS total_credit
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       ${whereClause}
      GROUP BY coa.account_code, je.entry_type`
  );

  let cashSalesInflow = 0;
  let opexCashOutflow = 0;
  let restockCashOutflow = 0;
  let equipmentInvestingOutflow = 0;
  let capitalInflow = 0;
  let drawingOutflow = 0;

  for (const l of lines) {
    const code = l.account_code;
    const type = l.entry_type;
    const debit = Number(l.total_debit || 0);
    const credit = Number(l.total_credit || 0);

    // Liquid accounts: 1010, 1020, 1030
    if (["1010", "1020", "1030"].includes(code)) {
      if (type === "sales_revenue") cashSalesInflow += (debit - credit);
      else if (type === "operating_expense") opexCashOutflow += (credit - debit);
      else if (type === "inventory_restock") restockCashOutflow += (credit - debit);
      else if (type === "capital_injection" || type === "opening_balance") capitalInflow += (debit - credit);
      else if (type === "owner_withdrawal") drawingOutflow += (credit - debit);
    }
    if (code === "1510") {
      equipmentInvestingOutflow += (debit - credit);
    }
  }

  const operatingCashFlow = round2(cashSalesInflow - (opexCashOutflow + restockCashOutflow));
  const investingCashFlow = round2(-Math.max(0, equipmentInvestingOutflow));
  const financingCashFlow = round2(capitalInflow - drawingOutflow);
  const netCashFlow = round2(operatingCashFlow + investingCashFlow + financingCashFlow);

  response.json({
    operatingActivities: {
      cashSalesInflow: round2(cashSalesInflow),
      opexCashOutflow: round2(opexCashOutflow),
      restockCashOutflow: round2(restockCashOutflow),
      netOperatingCashFlow: operatingCashFlow,
    },
    investingActivities: {
      equipmentPurchased: round2(equipmentInvestingOutflow),
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
  const { from, to, page = 1, limit = 25 } = request.query || {};
  const numPage = Math.max(1, Number(page) || 1);
  const numLimit = Math.min(100, Math.max(1, Number(limit) || 25));
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

  const accountMap = new Map();
  for (const acc of accounts) {
    accountMap.set(acc.account_code, round2(acc.current_balance));
  }

  const cashDrawer = accountMap.get("1010") || 0.00;
  const gcash = accountMap.get("1020") || 0.00;
  const bank = accountMap.get("1030") || 0.00;
  const reserve = accountMap.get("1040") || 0.00;
  const equipment = accountMap.get("1510") || 0.00;

  const currentAssets = [
    { accountCode: "1010", accountName: "Cash Drawer (Counter 1)", amount: cashDrawer },
    { accountCode: "1020", accountName: "GCash Official Wallet", amount: gcash },
    { accountCode: "1030", accountName: "Store Bank Account", amount: bank },
    { accountCode: "1040", accountName: "Owner Capital Reserve", amount: reserve },
    { accountCode: "1050", accountName: "Merchandise Inventory (Live Stock)", amount: liveInventoryValue },
  ];
  const nonCurrentAssets = [
    { accountCode: "1510", accountName: "Kitchen & Espresso Equipment", amount: equipment },
  ];
  const totalAssets = round2(cashDrawer + gcash + bank + reserve + liveInventoryValue + equipment);

  const payables = accountMap.get("2010") || 0.00;
  const taxesPayable = accountMap.get("2020") || 0.00;
  const currentLiabilities = [
    { accountCode: "2010", accountName: "Accounts Payable (Suppliers)", amount: payables },
    { accountCode: "2020", accountName: "Local Business Taxes Payable", amount: taxesPayable },
  ];
  const totalLiabilities = round2(payables + taxesPayable);

  const ownerCapital = accountMap.get("3010") || 0.00;
  const ownerDrawings = accountMap.get("3020") || 0.00;
  const retainedEarnings = round2(totalAssets - totalLiabilities - (ownerCapital - ownerDrawings));
  const totalEquity = round2(ownerCapital - ownerDrawings + retainedEarnings);

  const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.005;

  response.json({
    asOfDate: new Date().toISOString().slice(0, 10),
    assets: {
      current: currentAssets,
      nonCurrent: nonCurrentAssets,
      totalAssets,
    },
    totalAssets,
    liabilities: {
      current: currentLiabilities,
      totalLiabilities,
    },
    totalLiabilities,
    equity: {
      capital: ownerCapital,
      ownerCapital,
      drawings: ownerDrawings,
      ownerDrawings,
      retainedEarnings,
      totalEquity,
    },
    totalEquity,
    isBalanced,
  });
});

export default router;
