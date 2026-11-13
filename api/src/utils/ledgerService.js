import { httpError } from "../middleware/auth.js";

export function round2(val) {
  const num = Number(val ?? 0);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : 0.0;
}

export function generateEntryNumber(type) {
  const prefix = String(type || "JE").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "JE";
  const rand = Math.floor(Math.random() * 100_000).toString().padStart(5, "0");
  return `JE-${prefix}-${Date.now().toString().slice(-6)}-${rand}`;
}

export function getManilaDateString(date = new Date()) {
  const target = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(target);
}

export function isValidIsoDateOnly(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
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
    `SELECT id, account_code FROM chart_of_accounts WHERE account_code IN (${codes.map(() => "?").join(",")})`,
    codes
  );
  const codeMap = new Map(accRows.map((r) => [r.account_code, Number(r.id)]));
  for (const l of normalizedLines) {
    if (!codeMap.has(l.accountCode)) {
      throw httpError(400, `Account code '${l.accountCode}' not found in Chart of Accounts.`);
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
        "SELECT id FROM journal_entries WHERE idempotency_key = ? LIMIT 1",
        [idempotencyKey]
      );
      return { skipped: true, entryId: dup ? Number(dup.id) : null };
    }
    throw err;
  }

  const entryId = headerResult.insertId;
  for (const line of normalizedLines) {
    await connection.execute(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo)
       VALUES (?, ?, ?, ?, ?)`,
      [entryId, codeMap.get(line.accountCode), line.debit, line.credit, line.lineMemo]
    );
  }

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
  // 1. Reverse original sales_revenue entry if one was posted
  const [[salesEntry]] = await connection.execute(
    `SELECT je.id, je.entry_number
       FROM journal_entries je
      WHERE je.order_id = ?
        AND je.entry_type = 'sales_revenue'
        AND je.is_reversal = FALSE
        AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reverses_entry_id = je.id)
      LIMIT 1`,
    [orderId]
  );

  if (salesEntry) {
    const [salesLines] = await connection.execute(
      `SELECT jel.debit, jel.credit, coa.account_code
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id = ?`,
      [salesEntry.id]
    );
    if (salesLines.length >= 2) {
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
        lines: salesLines.map((l) => ({
          accountCode: l.account_code,
          debit: round2(l.credit),
          credit: round2(l.debit),
          lineMemo: `Void reversal for ${orderNumber}`,
        })),
      });
    }
  }

  // 2. Reverse or reclassify COGS depending on restoreStock
  const [[cogsEntry]] = await connection.execute(
    `SELECT je.id, je.entry_number
       FROM journal_entries je
      WHERE je.order_id = ?
        AND je.entry_type = 'cogs_consumption'
        AND je.is_reversal = FALSE
        AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reverses_entry_id = je.id)
      LIMIT 1`,
    [orderId]
  );

  if (restoreStock) {
    if (cogsEntry) {
      const [cogsLines] = await connection.execute(
        `SELECT jel.debit, jel.credit, coa.account_code
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE jel.journal_entry_id = ?`,
        [cogsEntry.id]
      );
      if (cogsLines.length >= 2) {
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
          lines: cogsLines.map((l) => ({
            accountCode: l.account_code,
            debit: round2(l.credit),
            credit: round2(l.debit),
            lineMemo: `Inventory restored on void ${orderNumber}`,
          })),
        });
      }
    }
  } else {
    // Spoilage: reclassify COGS (or unposted inventory loss) into 6030 Inventory Wastage & Spoilage
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
    idempotencyKey: inventoryMovementId ? `inv_move:${inventoryMovementId}:${entryType}` : null,
    createdBy: userId,
    lines,
  });
}
