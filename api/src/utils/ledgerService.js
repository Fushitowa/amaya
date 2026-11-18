import { httpError } from "../middleware/auth.js";
import { round2 } from "../../../shared/units.js";
import { getManilaDateString, isValidIsoDateOnly } from "../../../shared/manilaDate.js";
import { parseStrictFiniteNumber } from "./wasteMeasurement.js";

export { round2, getManilaDateString, isValidIsoDateOnly };

export function parseExactMoney(raw, label = "Amount", { allowZero = false } = {}) {
  const num = parseStrictFiniteNumber(raw);
  if (num === null) {
    throw httpError(400, `${label} must be a finite number.`);
  }
  if (allowZero ? num < 0 : num <= 0) {
    throw httpError(
      400,
      allowZero ? `${label} must be a finite non-negative number.` : `${label} must be a finite positive number.`,
    );
  }
  if (num > 999_999_999_999.99) {
    throw httpError(400, `${label} exceeds the maximum allowed ledger precision (₱999,999,999,999.99).`);
  }
  const rounded = round2(num);
  if (Math.abs(num - rounded) >= 1e-6) {
    throw httpError(400, `${label} cannot exceed 2 decimal places (sub-centavo precision rejected).`);
  }
  return rounded;
}

/**
 * Resolve an active cashier shift without silently binding onto another user's open drawer.
 * Back-office operations (expenses, withdrawals, restocks, waste) only attach to the actor's
 * own open shift unless an explicit `explicitSessionId` (or `fallbackSessionId`) is provided.
 */
export async function resolveActiveSessionId(connection, userId, optionsOrFallback = null) {
  const opts =
    optionsOrFallback !== null && typeof optionsOrFallback === "object"
      ? optionsOrFallback
      : { fallbackSessionId: optionsOrFallback };
  const {
    explicitSessionId = null,
    fallbackSessionId = null,
    requireOpenForExplicit = true,
  } = opts;

  if (explicitSessionId !== null && explicitSessionId !== undefined && explicitSessionId !== "") {
    const parsedExplicit = Number(explicitSessionId);
    if (!Number.isSafeInteger(parsedExplicit) || parsedExplicit <= 0) {
      throw httpError(400, "Invalid sessionId.");
    }
    const [[explicitRow]] = await connection.execute(
      "SELECT id, status FROM cashier_sessions WHERE id = ? LIMIT 1",
      [parsedExplicit],
    );
    if (!explicitRow) {
      throw httpError(404, "Cashier session not found.");
    }
    if (requireOpenForExplicit && explicitRow.status !== "open") {
      throw httpError(409, "Selected cashier session is closed.");
    }
    return Number(explicitRow.id);
  }

  const [[activeSession]] = await connection.execute(
    "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
    [userId],
  );
  if (activeSession) {
    return Number(activeSession.id);
  }
  return fallbackSessionId ? Number(fallbackSessionId) : null;
}

export function stripCostFromNote(noteText) {
  if (!noteText) return "";
  return String(noteText)
    .replace(/ for ₱[0-9.,]+ · new avg ₱[0-9.,]+\/[^)]+/gi, "")
    .replace(/\s*\([^)]*₱[^)]*\)/g, "")
    .replace(/₱\s*[0-9.,]+/g, "")
    .trim();
}

export function generateEntryNumber(type) {
  const prefix = String(type || "JE").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "JE";
  const rand = Math.floor(Math.random() * 100_000).toString().padStart(5, "0");
  return `JE-${prefix}-${Date.now().toString().slice(-6)}-${rand}`;
}

export function assertValidDateRange(from, to) {
  const cleanFrom = from === undefined || from === null ? "" : String(from).trim();
  const cleanTo = to === undefined || to === null ? "" : String(to).trim();
  if (cleanFrom && !isValidIsoDateOnly(cleanFrom)) {
    throw httpError(400, "Invalid 'from' date. Expected YYYY-MM-DD.");
  }
  if (cleanTo && !isValidIsoDateOnly(cleanTo)) {
    throw httpError(400, "Invalid 'to' date. Expected YYYY-MM-DD.");
  }
  if (cleanFrom && cleanTo && cleanFrom > cleanTo) {
    throw httpError(400, "Start date must be on or before end date.");
  }
  return { from: cleanFrom || null, to: cleanTo || null };
}

export function parseBoundedPositiveInt(raw, fallback, min, max, label = "Parameter") {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const str = String(raw).trim();
  if (!/^\d+$/.test(str)) {
    throw httpError(400, `${label} must be a whole integer between ${min} and ${max}.`);
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw httpError(400, `${label} must be between ${min} and ${max}.`);
  }
  return num;
}

export function resolveTenderAccountCode(paymentMethod) {
  const normalized = String(paymentMethod || "Cash").trim().toLowerCase();
  if (normalized === "gcash") return "1020";
  if (normalized === "card" || normalized === "bank") return "1030";
  return "1010";
}

/**
 * Insert a balanced double-entry journal header and lines atomically on `connection`.
 * Supports optional `idempotencyKey` (returns { skipped: true } cleanly if already posted).
 */
export async function postBalancedEntry(connection, {
  entryType,
  memo,
  referenceNumber = null,
  orderId = null,
  inventoryMovementId = null,
  sessionId = null,
  payableId = null,
  reversesEntryId = null,
  isReversal = false,
  idempotencyKey = null,
  entryDate = null,
  createdBy,
  lines = [],
}) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw httpError(400, "A journal entry must contain at least 2 lines.");
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const normalizedLines = [];

  for (const line of lines) {
    const accountCode = String(line.accountCode || "").trim();
    const rawDebit = Number(line.debit ?? 0);
    const rawCredit = Number(line.credit ?? 0);
    if (!accountCode) throw httpError(400, "Every journal line requires an accountCode.");
    if (!Number.isFinite(rawDebit) || !Number.isFinite(rawCredit) || rawDebit < 0 || rawCredit < 0) {
      throw httpError(400, "Journal line amounts must be finite non-negative numbers.");
    }
    const debit = round2(rawDebit);
    const credit = round2(rawCredit);
    if (debit === 0 && credit === 0) continue;
    totalDebit += debit;
    totalCredit += credit;
    normalizedLines.push({
      accountCode,
      debit,
      credit,
      lineMemo: line.lineMemo ? String(line.lineMemo).slice(0, 255) : null,
    });
  }

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);

  if (normalizedLines.length < 2 || totalDebit <= 0) {
    return { skipped: true, entryId: null };
  }
  if (Math.abs(totalDebit - totalCredit) >= 0.005) {
    throw httpError(
      400,
      `Double-entry parity violation: total debits (${totalDebit.toFixed(2)}) and credits (${totalCredit.toFixed(2)}) do not balance.`
    );
  }

  if (idempotencyKey) {
    const [[existing]] = await connection.execute(
      "SELECT id FROM journal_entries WHERE idempotency_key = ? LIMIT 1",
      [idempotencyKey]
    );
    if (existing) {
      return { skipped: true, entryId: Number(existing.id) };
    }
  }

  const codes = [...new Set(normalizedLines.map((l) => l.accountCode))];
  const [accRows] = await connection.query(
    `SELECT id, account_code FROM chart_of_accounts WHERE is_active = TRUE AND account_code IN (${codes.map(() => "?").join(",")})`,
    codes
  );
  const codeMap = new Map(accRows.map((r) => [r.account_code, Number(r.id)]));
  for (const l of normalizedLines) {
    if (!codeMap.has(l.accountCode)) {
      throw httpError(400, `Account code '${l.accountCode}' is inactive or not found in Chart of Accounts.`);
    }
  }

  const entryNumber = generateEntryNumber(entryType);
  let headerResult;
  try {
    const columns = [
      "entry_number",
      "entry_type",
      "memo",
      "reference_number",
      "order_id",
      "inventory_movement_id",
      "session_id",
      "payable_id",
      "is_reversal",
      "reverses_entry_id",
      "idempotency_key",
      "created_by",
    ];
    const values = [
      entryNumber,
      entryType,
      String(memo || entryType).slice(0, 255),
      referenceNumber ? String(referenceNumber).slice(0, 100) : null,
      orderId ?? null,
      inventoryMovementId ?? null,
      sessionId ?? null,
      payableId ?? null,
      isReversal ? 1 : 0,
      reversesEntryId ?? null,
      idempotencyKey || null,
      createdBy,
    ];
    if (entryDate) {
      columns.push("entry_date");
      values.push(entryDate);
    }
    const placeholders = columns.map(() => "?").join(", ");
    [headerResult] = await connection.execute(
      `INSERT INTO journal_entries (${columns.join(", ")}) VALUES (${placeholders})`,
      values
    );
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY" && idempotencyKey) {
      const [[dup]] = await connection.execute(
        "SELECT id FROM journal_entries WHERE idempotency_key = ? LIMIT 1 LOCK IN SHARE MODE",
        [idempotencyKey]
      );
      return { skipped: true, entryId: dup ? Number(dup.id) : null };
    }
    throw err;
  }

  const entryId = headerResult.insertId;
  const lineRows = normalizedLines.map((line) => [
    entryId,
    codeMap.get(line.accountCode),
    line.debit,
    line.credit,
    line.lineMemo,
  ]);
  await connection.query(
    `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo)
     VALUES ?`,
    [lineRows],
  );

  return { skipped: false, entryId: Number(entryId), amount: totalDebit };
}

/**
 * Post balanced sales_revenue and cogs_consumption entries for a paid non-cancelled order.
 */
export async function postOrderSaleAndCogs(connection, {
  orderId,
  orderNumber,
  total,
  subtotal: _subtotal,
  discountAmount = 0,
  taxAmount = 0,
  paymentMethod = "Cash",
  totalCogs = 0,
  sessionId = null,
  entryDate = null,
  userId,
}) {
  const cleanTotal = round2(total);
  const cleanDiscount = round2(Math.max(0, discountAmount));
  const cleanTax = round2(Math.max(0, taxAmount));
  const cleanGrossSales = round2(cleanTotal + cleanDiscount - cleanTax);
  const tenderAccount = resolveTenderAccountCode(paymentMethod);

  if (cleanTotal > 0 && cleanGrossSales >= 0) {
    const revLines = [
      {
        accountCode: tenderAccount,
        debit: cleanTotal,
        credit: 0,
        lineMemo: `${paymentMethod} collection for Order ${orderNumber}`,
      },
    ];
    if (cleanDiscount > 0) {
      revLines.push({
        accountCode: "4020",
        debit: cleanDiscount,
        credit: 0,
        lineMemo: `Sales discount on Order ${orderNumber}`,
      });
    }
    revLines.push({
      accountCode: "4010",
      debit: 0,
      credit: cleanGrossSales > 0 ? cleanGrossSales : cleanTotal,
      lineMemo: `POS revenue for Order ${orderNumber}`,
    });
    if (cleanTax > 0) {
      revLines.push({
        accountCode: "2020",
        debit: 0,
        credit: cleanTax,
        lineMemo: `VAT/Tax payable on Order ${orderNumber}`,
      });
    }

    await postBalancedEntry(connection, {
      entryType: "sales_revenue",
      memo: `POS Sale #${orderNumber} (${paymentMethod})`,
      referenceNumber: orderNumber,
      orderId,
      sessionId,
      idempotencyKey: `order:${orderId}:sales_revenue`,
      entryDate,
      createdBy: userId,
      lines: revLines,
    });
  }

  const cleanCogs = round2(totalCogs);
  if (cleanCogs > 0) {
    await postBalancedEntry(connection, {
      entryType: "cogs_consumption",
      memo: `COGS consumed for Order #${orderNumber}`,
      referenceNumber: orderNumber,
      orderId,
      sessionId,
      idempotencyKey: `order:${orderId}:cogs_consumption`,
      entryDate,
      createdBy: userId,
      lines: [
        { accountCode: "5010", debit: cleanCogs, credit: 0, lineMemo: `Ingredient/item COGS for ${orderNumber}` },
        { accountCode: "1050", debit: 0, credit: cleanCogs, lineMemo: `Inventory deducted for ${orderNumber}` },
      ],
    });
  }
}

/**
 * Compute remaining unreversed lines for an original journal entry after subtracting
 * any prior partial reversal entries referencing `reverses_entry_id = origEntryId`.
 */
async function buildRemainingReversalLines(connection, orderId, origEntryId, { lineMemo, extraOffsets = [] } = {}) {
  const [origLines] = await connection.execute(
    `SELECT coa.account_code, jel.debit, jel.credit
       FROM journal_entry_lines jel
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE jel.journal_entry_id = ?`,
    [origEntryId]
  );
  if (!origLines.length) return [];

  const [priorRevs] = await connection.execute(
    `SELECT coa.account_code,
            COALESCE(SUM(jel.debit), 0) AS rev_debit,
            COALESCE(SUM(jel.credit), 0) AS rev_credit
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
      WHERE je.order_id = ?
        AND je.is_reversal = TRUE
        AND je.reverses_entry_id = ?
      GROUP BY coa.account_code`,
    [orderId, origEntryId]
  );

  const netByAccount = new Map();
  for (const l of origLines) {
    const prev = netByAccount.get(l.account_code) || 0;
    netByAccount.set(l.account_code, round2(prev + round2(l.debit) - round2(l.credit)));
  }
  for (const r of priorRevs) {
    const prev = netByAccount.get(r.account_code) || 0;
    netByAccount.set(r.account_code, round2(prev + round2(r.rev_debit) - round2(r.rev_credit)));
  }
  for (const off of extraOffsets) {
    const prev = netByAccount.get(off.accountCode) || 0;
    netByAccount.set(off.accountCode, round2(prev + round2(off.netDelta)));
  }

  const lines = [];
  for (const [accountCode, net] of netByAccount.entries()) {
    const cleanNet = round2(net);
    if (cleanNet > 0) {
      lines.push({ accountCode, debit: 0, credit: cleanNet, lineMemo });
    } else if (cleanNet < 0) {
      lines.push({ accountCode, debit: round2(Math.abs(cleanNet)), credit: 0, lineMemo });
    }
  }
  return lines;
}

/**
 * Post traceable reversal entries when an order is voided, and handle restoreStock vs spoilage (6030).
 */
export async function postOrderVoidReversal(connection, {
  orderId,
  orderNumber,
  restoreStock = true,
  totalCogs = 0,
  reason = "Voided order",
  sessionId = null,
  userId,
}) {
  // 1. Reverse remaining unreversed portion of original sales_revenue entry if one was posted
  const [[salesEntry]] = await connection.execute(
    `SELECT je.id, je.entry_number
       FROM journal_entries je
      WHERE je.order_id = ?
        AND je.entry_type = 'sales_revenue'
        AND je.is_reversal = FALSE
      LIMIT 1`,
    [orderId]
  );

  if (salesEntry) {
    const remainingSalesLines = await buildRemainingReversalLines(connection, orderId, Number(salesEntry.id), {
      lineMemo: `Void reversal for ${orderNumber}`,
    });
    if (remainingSalesLines.length >= 2) {
      await postBalancedEntry(connection, {
        entryType: "void_reversal",
        memo: `Void reversal (${salesEntry.entry_number}) Order #${orderNumber}: ${reason}`,
        referenceNumber: orderNumber,
        orderId,
        sessionId,
        isReversal: true,
        reversesEntryId: Number(salesEntry.id),
        idempotencyKey: `order:${orderId}:void_sales`,
        createdBy: userId,
        lines: remainingSalesLines,
      });
    }
  }

  // 2. Reverse remaining unreversed COGS or reclassify remaining COGS into spoilage (6030)
  const [[cogsEntry]] = await connection.execute(
    `SELECT je.id, je.entry_number
       FROM journal_entries je
      WHERE je.order_id = ?
        AND je.entry_type = 'cogs_consumption'
        AND je.is_reversal = FALSE
      LIMIT 1`,
    [orderId]
  );

  if (restoreStock) {
    if (cogsEntry) {
      // If earlier partial item reverts recorded spoilage (DR 6030 / CR 5010), do not restore/re-credit those amounts.
      const [[priorSpoilageRow]] = await connection.execute(
        `SELECT COALESCE(SUM(jel.credit), 0) AS spoiled_cogs
           FROM journal_entries je
           JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE je.order_id = ?
            AND je.entry_type = 'adjustment'
            AND je.idempotency_key LIKE CONCAT('order:', ?, ':revert:%:spoilage')
            AND coa.account_code = '5010'`,
        [orderId, orderId]
      );
      const priorSpoiledCogs = round2(priorSpoilageRow?.spoiled_cogs || 0);
      const extraOffsets = priorSpoiledCogs > 0
        ? [
            { accountCode: "5010", netDelta: -priorSpoiledCogs },
            { accountCode: "1050", netDelta: priorSpoiledCogs },
          ]
        : [];
      const remainingCogsLines = await buildRemainingReversalLines(connection, orderId, Number(cogsEntry.id), {
        lineMemo: `Inventory restored on void ${orderNumber}`,
        extraOffsets,
      });
      if (remainingCogsLines.length >= 2) {
        await postBalancedEntry(connection, {
          entryType: "void_reversal",
          memo: `Stock restore COGS reversal for Order #${orderNumber}: ${reason}`,
          referenceNumber: orderNumber,
          orderId,
          sessionId,
          isReversal: true,
          reversesEntryId: Number(cogsEntry.id),
          idempotencyKey: `order:${orderId}:void_cogs_restore`,
          createdBy: userId,
          lines: remainingCogsLines,
        });
      }
    }
  } else {
    // Spoilage: reclassify remaining COGS (or unposted inventory loss) into 6030 Inventory Wastage & Spoilage
    const cleanLoss = round2(totalCogs);
    if (cleanLoss > 0) {
      const creditAcc = cogsEntry ? "5010" : "1050";
      await postBalancedEntry(connection, {
        entryType: "adjustment",
        memo: `Spoilage wastage on voided Order #${orderNumber}: ${reason}`,
        referenceNumber: orderNumber,
        orderId,
        sessionId,
        idempotencyKey: `order:${orderId}:void_spoilage`,
        createdBy: userId,
        lines: [
          { accountCode: "6030", debit: cleanLoss, credit: 0, lineMemo: `Spoilage loss ${orderNumber}` },
          { accountCode: creditAcc, debit: 0, credit: cleanLoss, lineMemo: `Offset spoilage for ${orderNumber}` },
        ],
      });
    }
  }
}

/**
 * Post proportional double-entry reversal when a specific order line (or partial qty) is reverted.
 */
export async function postOrderItemRevertReversal(connection, {
  orderId,
  orderNumber,
  revertKey,
  subtotalDelta,
  discountDelta = 0,
  taxDelta = 0,
  totalDelta = 0,
  cogsDelta = 0,
  restoreStock = true,
  paymentMethod = "Cash",
  reason = "Reverted item",
  sessionId = null,
  userId,
}) {
  void subtotalDelta;
  const [[salesEntry]] = await connection.execute(
    `SELECT je.id, je.entry_number
       FROM journal_entries je
      WHERE je.order_id = ?
        AND je.entry_type = 'sales_revenue'
        AND je.is_reversal = FALSE
      LIMIT 1`,
    [orderId]
  );

  const cleanTotalDelta = round2(Math.max(0, totalDelta));
  const cleanDiscountDelta = round2(Math.max(0, discountDelta));
  const cleanTaxDelta = round2(Math.max(0, taxDelta));
  const cleanGrossSalesDelta = round2(cleanTotalDelta + cleanDiscountDelta - cleanTaxDelta);
  const tenderAccount = resolveTenderAccountCode(paymentMethod);

  if (cleanTotalDelta > 0 && cleanGrossSalesDelta >= 0) {
    const revLines = [];
    if (cleanGrossSalesDelta > 0) {
      revLines.push({
        accountCode: "4010",
        debit: cleanGrossSalesDelta,
        credit: 0,
        lineMemo: `Item revert revenue reversal Order ${orderNumber}`,
      });
    }
    if (cleanTaxDelta > 0) {
      revLines.push({
        accountCode: "2020",
        debit: cleanTaxDelta,
        credit: 0,
        lineMemo: `Item revert VAT/Tax reversal Order ${orderNumber}`,
      });
    }
    revLines.push({
      accountCode: tenderAccount,
      debit: 0,
      credit: cleanTotalDelta,
      lineMemo: `Item revert ${paymentMethod} reversal Order ${orderNumber}`,
    });
    if (cleanDiscountDelta > 0) {
      revLines.push({
        accountCode: "4020",
        debit: 0,
        credit: cleanDiscountDelta,
        lineMemo: `Item revert discount reversal Order ${orderNumber}`,
      });
    }

    await postBalancedEntry(connection, {
      entryType: "void_reversal",
      memo: `Item revert sales reversal Order #${orderNumber}: ${reason}`,
      referenceNumber: orderNumber,
      orderId,
      sessionId,
      isReversal: true,
      reversesEntryId: salesEntry?.id ? Number(salesEntry.id) : null,
      idempotencyKey: `order:${orderId}:revert:${revertKey}:sales`,
      createdBy: userId,
      lines: revLines,
    });
  }

  const cleanCogsDelta = round2(cogsDelta);
  if (cleanCogsDelta > 0) {
    const [[cogsEntry]] = await connection.execute(
      `SELECT je.id, je.entry_number
         FROM journal_entries je
        WHERE je.order_id = ?
          AND je.entry_type = 'cogs_consumption'
          AND je.is_reversal = FALSE
        LIMIT 1`,
      [orderId]
    );

    if (restoreStock) {
      await postBalancedEntry(connection, {
        entryType: "void_reversal",
        memo: `Item revert stock restore COGS reversal Order #${orderNumber}: ${reason}`,
        referenceNumber: orderNumber,
        orderId,
        sessionId,
        isReversal: true,
        reversesEntryId: cogsEntry?.id ? Number(cogsEntry.id) : null,
        idempotencyKey: `order:${orderId}:revert:${revertKey}:cogs`,
        createdBy: userId,
        lines: [
          { accountCode: "1050", debit: cleanCogsDelta, credit: 0, lineMemo: `Inventory restored on item revert ${orderNumber}` },
          { accountCode: "5010", debit: 0, credit: cleanCogsDelta, lineMemo: `COGS reversed on item revert ${orderNumber}` },
        ],
      });
    } else {
      const creditAcc = cogsEntry ? "5010" : "1050";
      await postBalancedEntry(connection, {
        entryType: "adjustment",
        memo: `Spoilage on reverted item Order #${orderNumber}: ${reason}`,
        referenceNumber: orderNumber,
        orderId,
        sessionId,
        idempotencyKey: `order:${orderId}:revert:${revertKey}:spoilage`,
        createdBy: userId,
        lines: [
          { accountCode: "6030", debit: cleanCogsDelta, credit: 0, lineMemo: `Item revert spoilage loss ${orderNumber}` },
          { accountCode: creditAcc, debit: 0, credit: cleanCogsDelta, lineMemo: `Offset spoilage for ${orderNumber}` },
        ],
      });
    }
  }
}

/**
 * Post balanced inventory valuation change for opening stock or manual quantity/cost edits.
 */
export async function postInventoryValuationDelta(connection, {
  inventoryMovementId = null,
  itemName,
  deltaValue,
  entryType = "adjustment",
  offsetAccountCode = null,
  memo,
  referenceNumber = null,
  sessionId = null,
  idempotencyKey = null,
  userId,
}) {
  const cleanDelta = round2(deltaValue);
  if (Math.abs(cleanDelta) < 0.01) return { skipped: true, entryId: null };

  const absVal = round2(Math.abs(cleanDelta));
  const isIncrease = cleanDelta > 0;
  const resolvedOffset = offsetAccountCode || (isIncrease ? "3010" : "6030");
  const lines = isIncrease
    ? [
        { accountCode: "1050", debit: absVal, credit: 0, lineMemo: `Increase 1050 for ${itemName}` },
        { accountCode: resolvedOffset, debit: 0, credit: absVal, lineMemo: `Offset ${resolvedOffset} for ${itemName}` },
      ]
    : [
        { accountCode: resolvedOffset, debit: absVal, credit: 0, lineMemo: `Write-down ${itemName}` },
        { accountCode: "1050", debit: 0, credit: absVal, lineMemo: `Decrease 1050 for ${itemName}` },
      ];

  return postBalancedEntry(connection, {
    entryType,
    memo: memo || `Inventory valuation adjustment: ${itemName}`,
    referenceNumber,
    inventoryMovementId,
    sessionId,
    idempotencyKey: idempotencyKey || (inventoryMovementId ? `inv_move:${inventoryMovementId}:${entryType}` : null),
    createdBy: userId,
    lines,
  });
}

/**
 * Summarize journal or account-balance rows into Income Statement sections using
 * database-driven `report_section` and `expense_group` metadata.
 */
export function summarizeIncomeStatementLines(rows = [], { clampSections = true } = {}) {
  let grossSales = 0;
  let discounts = 0;
  let customerSalesCogs = 0;
  let foodSpoilageCogs = 0;
  let depreciation = 0;
  let tax = 0;
  const opexMap = new Map();

  for (const row of rows) {
    const section = String(row.report_section || row.reportSection || "").trim();
    if (!section || section === "balance_sheet") continue;

    const code = String(row.account_code || row.accountCode || "").trim();
    const hasDebitCredit =
      row.total_debit !== undefined ||
      row.total_credit !== undefined ||
      row.total_debits !== undefined ||
      row.total_credits !== undefined;

    let amount;
    if (hasDebitCredit) {
      const debit = Number(row.total_debit ?? row.total_debits ?? 0);
      const credit = Number(row.total_credit ?? row.total_credits ?? 0);
      amount = section === "revenue" ? (credit - debit) : (debit - credit);
    } else {
      const bal = Number(row.current_balance ?? row.balance ?? 0);
      const normal = String(row.normal_balance || row.normalBalance || "").toLowerCase();
      amount = section === "revenue"
        ? (normal === "debit" ? -bal : bal)
        : (normal === "credit" ? -bal : bal);
    }

    if (section === "revenue") {
      grossSales += amount;
    } else if (section === "contra_revenue") {
      discounts += amount;
    } else if (section === "cogs") {
      if (code === "6030") {
        foodSpoilageCogs += amount;
      } else {
        customerSalesCogs += amount;
      }
    } else if (section === "opex") {
      const existing = opexMap.get(code) || {
        accountCode: code,
        accountName: row.account_name || row.accountName || code,
        expenseGroup: row.expense_group || row.expenseGroup || "Others",
        amount: 0,
      };
      existing.amount += amount;
      opexMap.set(code, existing);
    } else if (section === "depreciation") {
      depreciation += amount;
    } else if (section === "tax") {
      tax += amount;
    }
  }

  const roundedGrossSales = round2(clampSections ? Math.max(0, grossSales) : grossSales);
  const roundedDiscounts = round2(clampSections ? Math.max(0, discounts) : discounts);
  const netSales = round2(
    clampSections ? Math.max(0, roundedGrossSales - roundedDiscounts) : (roundedGrossSales - roundedDiscounts)
  );
  const roundedCustomerSalesCogs = round2(clampSections ? Math.max(0, customerSalesCogs) : customerSalesCogs);
  const roundedFoodSpoilageCogs = round2(clampSections ? Math.max(0, foodSpoilageCogs) : foodSpoilageCogs);
  const cogs = round2(roundedCustomerSalesCogs + roundedFoodSpoilageCogs);
  const grossProfit = round2(netSales - cogs);
  const grossMarginPercent = netSales > 0 ? round2((grossProfit / netSales) * 100) : 0.0;

  const operatingExpenses = [];
  let totalOpexRaw = 0;
  for (const item of [...opexMap.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode))) {
    const cleanAmount = round2(item.amount);
    if (cleanAmount !== 0) {
      operatingExpenses.push({
        accountCode: item.accountCode,
        accountName: item.accountName,
        expenseGroup: item.expenseGroup,
        amount: cleanAmount,
      });
      totalOpexRaw += cleanAmount;
    }
  }

  const totalOperatingExpenses = round2(totalOpexRaw);
  const roundedDepreciation = round2(depreciation);
  const roundedTax = round2(tax);
  const ebitdaOperatingIncome = round2(grossProfit - totalOperatingExpenses);
  const netIncomeBeforeTax = round2(ebitdaOperatingIncome - roundedDepreciation);
  const netIncome = round2(netIncomeBeforeTax - roundedTax);
  const netOperatingProfit = netIncome;

  return {
    grossSales: roundedGrossSales,
    discounts: roundedDiscounts,
    netSales,
    customerSalesCogs: roundedCustomerSalesCogs,
    foodSpoilageCogs: roundedFoodSpoilageCogs,
    cogs,
    grossProfit,
    grossMarginPercent,
    operatingExpenses,
    totalOperatingExpenses,
    depreciation: roundedDepreciation,
    tax: roundedTax,
    ebitdaOperatingIncome,
    netIncomeBeforeTax,
    netIncome,
    netOperatingProfit,
  };
}
