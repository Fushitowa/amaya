import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

function getManilaDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function round2(val) {
  return Number(Number(val ?? 0).toFixed(2));
}

describe("Tala TDD Suite: Phase 2 Income Statement Missing Items (22 Items, Payables, Depreciation, Tax, Security & UI)", () => {
  let server;
  let adminUser;
  let staffUser;
  let today;
  const tracker = createCleanupTracker();
  const createdJournalEntryIds = new Set();
  const createdPayableIds = new Set();
  const createdSnapshotDates = new Set();
  const createdItemNames = new Set();
  const createdActorNames = new Set();

  async function createTestInventoryItem({
    namePrefix = "TalaP2Inv",
    category = "Primary ingredient",
    quantity = 1000,
    unit = "g",
    purchasePrice = 200,
    packageQuantity = 1,
    packageUnit = "pack",
    contentsPerPackage = 1000,
  } = {}) {
    const itemName = makeUniqueTag(namePrefix);
    createdItemNames.add(itemName);
    const res = await server.requestJson("/api/inventory", {
      method: "POST",
      token: adminUser.token,
      body: {
        item: itemName,
        category,
        quantity,
        unit,
        purchasePrice,
        packageQuantity,
        packageUnit,
        contentsPerPackage,
      },
    });
    assert.equal(
      res.status,
      201,
      `Setup inventory item "${itemName}" must return HTTP 201, got ${res.status}: ${res.text}`,
    );
    tracker.inventoryItemIds.add(Number(res.data.id));
    return res.data;
  }

  async function createTestMenuProduct({
    namePrefix = "TalaP2Menu",
    basePrice = 100,
    inventoryItem,
    quantityUsed = 100,
    unit = "g",
  }) {
    const tag = makeUniqueTag("P2MenuCat");
    const categoryName = `Cat_${tag}`;
    const [catRes] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
      [categoryName],
    );
    tracker.menuCategoryIds.add(Number(catRes.insertId));

    const productName = makeUniqueTag(namePrefix);
    const res = await server.requestJson("/api/menu", {
      method: "POST",
      token: adminUser.token,
      body: {
        name: productName,
        category: categoryName,
        basePrice,
        stock: 50,
        available: true,
        ingredients: [
          {
            inventoryItemId: Number(inventoryItem.id),
            name: inventoryItem.item,
            quantityUsed,
            unit,
            stockUnit: inventoryItem.unit,
          },
        ],
      },
    });
    assert.equal(
      res.status,
      201,
      `Setup menu product "${productName}" must return HTTP 201, got ${res.status}: ${res.text}`,
    );
    tracker.productIds.add(Number(res.data.id));
    return res.data;
  }

  async function updateSettings(overrides) {
    const getRes = await server.requestJson("/api/settings", { token: adminUser.token });
    assert.equal(getRes.status, 200, `GET /api/settings failed: ${getRes.text}`);
    const putRes = await server.requestJson("/api/settings", {
      method: "PUT",
      token: adminUser.token,
      body: {
        ...getRes.data,
        ...overrides,
      },
    });
    assert.equal(putRes.status, 200, `PUT /api/settings failed: ${putRes.text}`);
    return putRes.data;
  }

  async function getLiquidNetSumForDate(dateStr) {
    const [[row]] = await pool.execute(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0.00) AS liquid_net
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE coa.account_code IN ('1010', '1020', '1030', '1040')
          AND je.entry_date >= ?
          AND je.entry_date <= ?`,
      [`${dateStr} 00:00:00`, `${dateStr} 23:59:59`],
    );
    return round2(row?.liquid_net || 0);
  }

  function findAccountBalance(bsData, side, code) {
    const bucket = side === "liability"
      ? (bsData?.liabilities?.current || [])
      : [...(bsData?.assets?.current || []), ...(bsData?.assets?.nonCurrent || [])];
    const row = bucket.find((entry) => entry.accountCode === code);
    return round2(row?.amount || 0);
  }

  before(async () => {
    today = getManilaDateString();
    await tracker.trackBusinessSettings();

    const [[existingTodaySnap]] = await pool.execute(
      "SELECT id FROM store_daily_asset_snapshots WHERE business_date = ? LIMIT 1",
      [today],
    );
    if (!existingTodaySnap) {
      createdSnapshotDates.add(today);
    }

    server = await startTestServer();
    adminUser = await tracker.createUser({
      role: "admin",
      displayName: makeUniqueTag("Tala P2 Admin"),
      username: makeUniqueTag("tala_p2_admin").toLowerCase(),
    });
    staffUser = await tracker.createUser({
      role: "staff",
      displayName: makeUniqueTag("Tala P2 Staff"),
      username: makeUniqueTag("tala_p2_staff").toLowerCase(),
    });
    createdActorNames.add(adminUser.displayName);
    createdActorNames.add(staffUser.displayName);

    await updateSettings({ vatEnabled: false, enforceShiftGate: false });
  });

  after(async () => {
    try {
      for (const pattern of [...createdItemNames, ...createdActorNames]) {
        const likeTerm = `%${pattern}%`;
        await pool.execute(
          `DELETE FROM notifications
            WHERE type = 'inventory_waste'
              AND (title LIKE ? OR message LIKE ?)`,
          [likeTerm, likeTerm],
        );
      }

      const uIds = [...tracker.userIds];
      const sIds = [...tracker.sessionIds];
      const invIds = [...tracker.inventoryItemIds];

      if (uIds.length > 0 || sIds.length > 0) {
        const ordConds = [];
        const ordParams = [];
        if (uIds.length > 0) {
          ordConds.push(`created_by IN (${uIds.map(() => "?").join(",")})`);
          ordParams.push(...uIds);
        }
        if (sIds.length > 0) {
          ordConds.push(`session_id IN (${sIds.map(() => "?").join(",")})`);
          ordParams.push(...sIds);
        }
        const [foundOrders] = await pool.execute(
          `SELECT id FROM orders WHERE ${ordConds.join(" OR ")}`,
          ordParams,
        );
        for (const row of foundOrders) tracker.orderIds.add(Number(row.id));
      }

      const allOrderIds = [...tracker.orderIds];
      const movConds = [];
      const movParams = [];
      if (invIds.length > 0) {
        movConds.push(`inventory_item_id IN (${invIds.map(() => "?").join(",")})`);
        movParams.push(...invIds);
      }
      if (uIds.length > 0) {
        movConds.push(`user_id IN (${uIds.map(() => "?").join(",")})`);
        movParams.push(...uIds);
      }
      if (allOrderIds.length > 0) {
        movConds.push(`order_id IN (${allOrderIds.map(() => "?").join(",")})`);
        movParams.push(...allOrderIds);
      }
      if (sIds.length > 0) {
        movConds.push(`session_id IN (${sIds.map(() => "?").join(",")})`);
        movParams.push(...sIds);
      }

      const movIds = [];
      if (movConds.length > 0) {
        const [movRows] = await pool.execute(
          `SELECT id FROM inventory_movements WHERE ${movConds.join(" OR ")}`,
          movParams,
        );
        for (const row of movRows) movIds.push(Number(row.id));
      }

      const jeSet = new Set(createdJournalEntryIds);
      const jeConds = [];
      const jeParams = [];
      if (jeSet.size > 0) {
        const ids = [...jeSet];
        jeConds.push(`id IN (${ids.map(() => "?").join(",")})`);
        jeParams.push(...ids);
      }
      if (allOrderIds.length > 0) {
        jeConds.push(`order_id IN (${allOrderIds.map(() => "?").join(",")})`);
        jeParams.push(...allOrderIds);
      }
      if (sIds.length > 0) {
        jeConds.push(`session_id IN (${sIds.map(() => "?").join(",")})`);
        jeParams.push(...sIds);
      }
      if (movIds.length > 0) {
        jeConds.push(`inventory_movement_id IN (${movIds.map(() => "?").join(",")})`);
        jeParams.push(...movIds);
      }
      if (uIds.length > 0) {
        jeConds.push(`created_by IN (${uIds.map(() => "?").join(",")})`);
        jeParams.push(...uIds);
      }

      if (jeConds.length > 0) {
        const [jeRows] = await pool.execute(
          `SELECT id FROM journal_entries WHERE ${jeConds.join(" OR ")}`,
          jeParams,
        );
        for (const row of jeRows) jeSet.add(Number(row.id));
      }

      // Clean financial_payables (if table exists) BEFORE deleting journal_entries (fk_fp_incurred_je is RESTRICT)
      const [[fpTable]] = await pool.execute(
        `SELECT TABLE_NAME
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'financial_payables'
          LIMIT 1`,
      );
      if (fpTable) {
        const [[payableIdCol]] = await pool.execute(
          `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'journal_entries'
              AND COLUMN_NAME = 'payable_id'
            LIMIT 1`,
        );

        const fpConds = [];
        const fpParams = [];
        if (createdPayableIds.size > 0) {
          const pIds = [...createdPayableIds];
          fpConds.push(`id IN (${pIds.map(() => "?").join(",")})`);
          fpParams.push(...pIds);
        }
        if (jeSet.size > 0) {
          const jIds = [...jeSet];
          fpConds.push(`incurred_journal_entry_id IN (${jIds.map(() => "?").join(",")})`);
          fpParams.push(...jIds);
        }
        if (uIds.length > 0) {
          fpConds.push(`created_by IN (${uIds.map(() => "?").join(",")})`);
          fpParams.push(...uIds);
        }
        if (sIds.length > 0) {
          fpConds.push(`session_id IN (${sIds.map(() => "?").join(",")})`);
          fpParams.push(...sIds);
        }

        const payableIdsSet = new Set(createdPayableIds);
        if (fpConds.length > 0) {
          const [fpRows] = await pool.execute(
            `SELECT id, incurred_journal_entry_id FROM financial_payables WHERE ${fpConds.join(" OR ")}`,
            fpParams,
          );
          for (const row of fpRows) {
            payableIdsSet.add(Number(row.id));
            if (row.incurred_journal_entry_id) jeSet.add(Number(row.incurred_journal_entry_id));
          }
        }

        const allPayableIds = [...payableIdsSet];
        if (payableIdCol && allPayableIds.length > 0) {
          const pMarks = allPayableIds.map(() => "?").join(",");
          const [linkedJes] = await pool.execute(
            `SELECT id FROM journal_entries WHERE payable_id IN (${pMarks})`,
            allPayableIds,
          );
          for (const row of linkedJes) jeSet.add(Number(row.id));

          await pool.execute(
            `UPDATE journal_entries SET payable_id = NULL WHERE payable_id IN (${pMarks})`,
            allPayableIds,
          );
        }

        if (payableIdCol && jeSet.size > 0) {
          const jIds = [...jeSet];
          await pool.execute(
            `UPDATE journal_entries SET payable_id = NULL WHERE id IN (${jIds.map(() => "?").join(",")})`,
            jIds,
          );
        }

        if (allPayableIds.length > 0) {
          await pool.execute(
            `DELETE FROM financial_payables WHERE id IN (${allPayableIds.map(() => "?").join(",")})`,
            allPayableIds,
          );
        }
      }

      const jeIds = [...jeSet];
      if (jeIds.length > 0) {
        const jeMarks = jeIds.map(() => "?").join(",");
        await pool.execute(
          `DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${jeMarks})`,
          jeIds,
        );
        await pool.execute(
          `UPDATE journal_entries
              SET reverses_entry_id = NULL
            WHERE id IN (${jeMarks}) OR reverses_entry_id IN (${jeMarks})`,
          [...jeIds, ...jeIds],
        );
        await pool.execute(`DELETE FROM journal_entries WHERE id IN (${jeMarks})`, jeIds);
      }

      if (createdSnapshotDates.size > 0) {
        const dates = [...createdSnapshotDates];
        await pool.execute(
          `DELETE FROM store_daily_asset_snapshots WHERE business_date IN (${dates.map(() => "?").join(",")})`,
          dates,
        );
      }

      await tracker.cleanup();
    } finally {
      try {
        if (server) await server.close();
      } finally {
        await pool.end();
      }
    }
  });

  // --------------------------------------------------------------------------
  // P2-1: 42-ACCOUNT COA & METADATA
  // --------------------------------------------------------------------------
  it("P2-1 (42-Account COA & Metadata): GET /api/finances/accounts returns all 42 active accounts (22 existing + 20 Phase 2 codes with exact metadata)", async () => {
    const res = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(res.status, 200, `GET /api/finances/accounts failed: ${res.text}`);

    const accounts = res.data?.accounts || [];
    assert.equal(accounts.length, 42, `Expected 42 active COA accounts, got ${accounts.length}`);

    const byCode = new Map(accounts.map((a) => [a.accountCode, a]));
    const existingCodes = [
      "1010", "1020", "1030", "1040", "1050", "1510",
      "2010", "2020",
      "3010", "3020",
      "4010", "4020",
      "5010",
      "6010", "6020", "6030", "6040",
      "6120", "6130", "6140", "6144", "6172",
    ];
    for (const code of existingCodes) {
      assert.ok(byCode.has(code), `Existing COA account '${code}' must remain active`);
    }

    const phase2Expectations = [
      ["1520", "asset", "credit", "balance_sheet", null],
      ["2030", "liability", "credit", "balance_sheet", null],
      ["6111", "expense", "debit", "opex", "Labor & Payroll"],
      ["6112", "expense", "debit", "opex", "Labor & Payroll"],
      ["6113", "expense", "debit", "opex", "Labor & Payroll"],
      ["6131", "expense", "debit", "opex", "Utilities"],
      ["6132", "expense", "debit", "opex", "Utilities"],
      ["6133", "expense", "debit", "opex", "Utilities"],
      ["6134", "expense", "debit", "opex", "Utilities"],
      ["6141", "expense", "debit", "opex", "Operating Supplies"],
      ["6142", "expense", "debit", "opex", "Operating Supplies"],
      ["6143", "expense", "debit", "opex", "Operating Supplies"],
      ["6150", "expense", "debit", "opex", "Advertising & Marketing"],
      ["6160", "expense", "debit", "opex", "Repairs & Maintenance"],
      ["6171", "expense", "debit", "opex", "General & Administrative (G&A)"],
      ["6173", "expense", "debit", "opex", "General & Administrative (G&A)"],
      ["6174", "expense", "debit", "opex", "General & Administrative (G&A)"],
      ["6179", "expense", "debit", "opex", "General & Administrative (G&A)"],
      ["6210", "expense", "debit", "depreciation", null],
      ["6310", "expense", "debit", "tax", null],
    ];

    for (const [code, category, normalBalance, reportSection, expenseGroup] of phase2Expectations) {
      const acc = byCode.get(code);
      assert.ok(acc, `Phase 2 COA account '${code}' must exist in GET /api/finances/accounts`);
      assert.equal(acc.category, category, `Account ${code} category must be '${category}', got '${acc.category}'`);
      assert.equal(
        acc.normalBalance,
        normalBalance,
        `Account ${code} normalBalance must be '${normalBalance}', got '${acc.normalBalance}'`,
      );
      assert.equal(
        acc.reportSection,
        reportSection,
        `Account ${code} reportSection must be '${reportSection}', got '${acc.reportSection}'`,
      );
      assert.equal(
        acc.expenseGroup ?? null,
        expenseGroup,
        `Account ${code} expenseGroup must be '${expenseGroup}', got '${acc.expenseGroup}'`,
      );
    }
  });

  // --------------------------------------------------------------------------
  // P2-2: PAID VS. UNPAID 2010 AP BILLS, SETTLEMENT, OVERPAY 409, RESTOCK ON CREDIT, REVERSAL PARITY
  // --------------------------------------------------------------------------
  it("P2-2 (2010 AP Payables & Settlement): unpaid OPEX hits P&L and 2010 with zero cash flow, settles partially/fully without OPEX double-count, blocks overpay/paid reversal (409), hooks 2010 restock, and reopens on settlement reversal", async () => {
    const [pnlBeforeRes, bsBeforeRes, cfBeforeRes] = await Promise.all([
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
    ]);
    assert.equal(pnlBeforeRes.status, 200);
    assert.equal(bsBeforeRes.status, 200);
    assert.equal(cfBeforeRes.status, 200);
    const pnlBefore = pnlBeforeRes.data;
    const bsBefore = bsBeforeRes.data;
    const cfBefore = cfBeforeRes.data;
    const ap2010Before = findAccountBalance(bsBefore, "liability", "2010");

    // 1. Post unpaid OPEX bill: DR 6131 / CR 2010 ₱1,200.00
    const billRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        amount: 1200.0,
        debitAccountCode: "6131",
        creditAccountCode: "2010",
        vendorName: makeUniqueTag("MeralcoP2"),
        dueDate: today,
        memo: "Unpaid electricity bill P2-2",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(billRes.status, 201, `Unpaid OPEX (DR 6131 / CR 2010) must return 201, got ${billRes.status}: ${billRes.text}`);
    const billEntryId = Number(billRes.data.entryId);
    createdJournalEntryIds.add(billEntryId);

    const [pnl1Res, bs1Res, cf1Res, payables1Res] = await Promise.all([
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson("/api/finances/payables?status=open&category=opex", { token: adminUser.token }),
    ]);
    assert.equal(pnl1Res.status, 200);
    assert.equal(bs1Res.status, 200);
    assert.equal(cf1Res.status, 200);
    assert.equal(payables1Res.status, 200, `GET /api/finances/payables must return 200, got ${payables1Res.status}: ${payables1Res.text}`);

    assert.equal(
      round2(pnl1Res.data.totalOperatingExpenses - pnlBefore.totalOperatingExpenses),
      1200.0,
      "Unpaid OPEX accrual must immediately increase P&L OPEX by ₱1,200.00",
    );
    assert.equal(bs1Res.data.isBalanced, true, "Balance Sheet must remain balanced after unpaid AP accrual");
    assert.equal(
      round2(findAccountBalance(bs1Res.data, "liability", "2010") - ap2010Before),
      1200.0,
      "Balance Sheet 2010 Accounts Payable must increase by ₱1,200.00",
    );
    assert.equal(
      round2(cf1Res.data.netCashFlow - cfBefore.netCashFlow),
      0.0,
      "Unpaid AP accrual must produce zero netCashFlow",
    );

    const opexPayable = (payables1Res.data?.items || []).find(
      (item) => Number(item.incurredJournalEntryId) === billEntryId,
    );
    assert.ok(opexPayable, "GET /api/finances/payables must list the new unpaid 2010 OPEX bill");
    createdPayableIds.add(Number(opexPayable.id));
    assert.equal(opexPayable.status, "unpaid");
    assert.equal(round2(opexPayable.originalAmount), 1200.0);
    assert.equal(round2(opexPayable.paidAmount), 0.0);

    // 2. Partial settlement ₱500 via 1030 Bank
    const settle1Res = await server.requestJson(`/api/finances/payables/${opexPayable.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: {
        paymentAccountCode: "1030",
        amount: 500.0,
        notes: "Partial bank payment for electricity bill",
        clientRequestId: randomUUID(),
      },
    });
    assert.ok(
      [200, 201].includes(settle1Res.status),
      `Partial settlement must succeed with 200/201, got ${settle1Res.status}: ${settle1Res.text}`,
    );
    const [[settle1Row]] = await pool.execute(
      `SELECT id FROM journal_entries
        WHERE payable_id = ? AND entry_type = 'ap_settlement' AND is_reversal = FALSE
        ORDER BY id ASC LIMIT 1`,
      [opexPayable.id],
    );
    assert.ok(settle1Row, "ap_settlement journal entry must link payable_id");
    const settle1JeId = Number(settle1Row.id);
    createdJournalEntryIds.add(settle1JeId);

    // Overpayment (> remaining ₱700) must reject with 409
    const overpayRes = await server.requestJson(`/api/finances/payables/${opexPayable.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: {
        paymentAccountCode: "1030",
        amount: 800.0,
        notes: "Overpayment attempt",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      overpayRes.status,
      409,
      `Overpaying payable beyond remaining balance must reject with 409, got ${overpayRes.status}: ${overpayRes.text}`,
    );

    // Reversing incurred bill while paid_amount > 0 must reject with 409
    const revPaidBillRes = await server.requestJson(`/api/finances/journal-entries/${billEntryId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Attempted reversal while partially paid" },
    });
    assert.equal(
      revPaidBillRes.status,
      409,
      `Reversing incurred bill with paid_amount > 0 must reject with 409, got ${revPaidBillRes.status}: ${revPaidBillRes.text}`,
    );

    // 3. Finalize remaining ₱700 settlement via 1030 Bank
    const settle2Res = await server.requestJson(`/api/finances/payables/${opexPayable.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: {
        paymentAccountCode: "1030",
        amount: 700.0,
        notes: "Final bank payment for electricity bill",
        clientRequestId: randomUUID(),
      },
    });
    assert.ok(
      [200, 201].includes(settle2Res.status),
      `Final settlement must succeed with 200/201, got ${settle2Res.status}: ${settle2Res.text}`,
    );
    const [[settle2Row]] = await pool.execute(
      `SELECT id FROM journal_entries
        WHERE payable_id = ? AND entry_type = 'ap_settlement' AND is_reversal = FALSE AND id <> ?
        ORDER BY id DESC LIMIT 1`,
      [opexPayable.id, settle1JeId],
    );
    assert.ok(settle2Row, "Second ap_settlement journal entry must link payable_id");
    const settle2JeId = Number(settle2Row.id);
    createdJournalEntryIds.add(settle2JeId);

    // Second settlement after fully paid must reject with 409
    const doubleSettleRes = await server.requestJson(`/api/finances/payables/${opexPayable.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: {
        paymentAccountCode: "1030",
        amount: 100.0,
        notes: "Duplicate settlement on paid bill",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      doubleSettleRes.status,
      409,
      `Settling an already-paid payable must reject with 409, got ${doubleSettleRes.status}: ${doubleSettleRes.text}`,
    );

    const [pnl2Res, bs2Res, cf2Res] = await Promise.all([
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
    ]);
    assert.equal(
      round2(pnl2Res.data.totalOperatingExpenses),
      round2(pnl1Res.data.totalOperatingExpenses),
      "Settling 2010 AP must NEVER double-count OPEX on P&L",
    );
    assert.equal(bs2Res.data.isBalanced, true);
    assert.equal(
      round2(findAccountBalance(bs2Res.data, "liability", "2010")),
      ap2010Before,
      "2010 Accounts Payable must return to pre-bill balance after full settlement",
    );
    assert.equal(
      round2(cf2Res.data.operatingActivities.opexCashOutflow - cfBefore.operatingActivities.opexCashOutflow),
      1200.0,
      "Settling OPEX 2010 AP must route ₱1,200.00 to Cash Flow opexCashOutflow",
    );

    // 4. Reverse ap_settlement JE -> atomically decrements paid_amount & reopens payable status
    const revSettle2Res = await server.requestJson(`/api/finances/journal-entries/${settle2JeId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Bounced bank transfer on final settlement" },
    });
    assert.equal(
      revSettle2Res.status,
      201,
      `Reversing ap_settlement JE must return 201, got ${revSettle2Res.status}: ${revSettle2Res.text}`,
    );
    createdJournalEntryIds.add(Number(revSettle2Res.data.reversalEntryId));

    const payablesAfterPartialRevRes = await server.requestJson("/api/finances/payables?status=all", {
      token: adminUser.token,
    });
    assert.equal(payablesAfterPartialRevRes.status, 200);
    const reopenedPartial = (payablesAfterPartialRevRes.data?.items || []).find(
      (item) => Number(item.id) === Number(opexPayable.id),
    );
    assert.ok(reopenedPartial);
    assert.equal(round2(reopenedPartial.paidAmount), 500.0, "Reversing ₱700 settlement must decrement paidAmount to ₱500.00");
    assert.equal(reopenedPartial.status, "partial", "Payable status must reopen to 'partial'");

    const revSettle1Res = await server.requestJson(`/api/finances/journal-entries/${settle1JeId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Reverse initial ₱500 settlement" },
    });
    assert.equal(revSettle1Res.status, 201);
    createdJournalEntryIds.add(Number(revSettle1Res.data.reversalEntryId));

    const payablesAfterFullRevRes = await server.requestJson("/api/finances/payables?status=all", {
      token: adminUser.token,
    });
    const reopenedUnpaid = (payablesAfterFullRevRes.data?.items || []).find(
      (item) => Number(item.id) === Number(opexPayable.id),
    );
    assert.equal(round2(reopenedUnpaid.paidAmount), 0.0, "Reversing remaining settlement must decrement paidAmount to ₱0.00");
    assert.equal(reopenedUnpaid.status, "unpaid", "Payable status must reopen to 'unpaid'");

    // Reversing unpaid incurred bill (paid_amount === 0) sets financial_payables.status = 'voided'
    const revUnpaidBillRes = await server.requestJson(`/api/finances/journal-entries/${billEntryId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Void reopened unpaid electricity bill" },
    });
    assert.equal(revUnpaidBillRes.status, 201, `Reversing unpaid bill failed: ${revUnpaidBillRes.text}`);
    createdJournalEntryIds.add(Number(revUnpaidBillRes.data.reversalEntryId));
    const [[voidedBillRow]] = await pool.execute(
      "SELECT status FROM financial_payables WHERE id = ? LIMIT 1",
      [opexPayable.id],
    );
    assert.equal(voidedBillRow?.status, "voided", "Reversing unpaid bill must mark financial_payables.status = 'voided'");

    // Staff RBAC on GET /api/finances/payables -> 403
    const staffPayablesRes = await server.requestJson("/api/finances/payables", {
      token: staffUser.token,
    });
    assert.equal(staffPayablesRes.status, 403, `Staff GET /api/finances/payables must reject 403, got ${staffPayablesRes.status}`);

    // DEF-P2-01 + F-05: Concurrent Promise.all (12x > connectionLimit: 10) partial settlement + mismatched replay 409 + concurrent full remaining settlement
    const concBillRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        amount: 1000.0,
        debitAccountCode: "6131",
        creditAccountCode: "2010",
        vendorName: makeUniqueTag("ConcUtilityP2"),
        dueDate: today,
        memo: "Unpaid ₱1,000 utility bill for DEF-P2-01 & F-05 12x concurrency",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(concBillRes.status, 201);
    const concBillJeId = Number(concBillRes.data.entryId);
    createdJournalEntryIds.add(concBillJeId);

    const concPayablesRes = await server.requestJson("/api/finances/payables?status=open&category=opex", {
      token: adminUser.token,
    });
    const concPayable = (concPayablesRes.data?.items || []).find(
      (item) => Number(item.incurredJournalEntryId) === concBillJeId,
    );
    assert.ok(concPayable, "Concurrent test payable must exist");
    createdPayableIds.add(Number(concPayable.id));

    const concPartialKey = randomUUID();
    const concPartialPayload = {
      paymentAccountCode: "1030",
      amount: 300.0,
      notes: "Concurrent partial settle DEF-P2-01 F-05 12x",
      clientRequestId: concPartialKey,
    };
    const concPartialResponses = await Promise.all(
      Array.from({ length: 12 }, () =>
        server.requestJson(`/api/finances/payables/${concPayable.id}/settle`, {
          method: "POST",
          token: adminUser.token,
          body: concPartialPayload,
        }),
      ),
    );
    assert.equal(concPartialResponses.length, 12);
    for (const r of concPartialResponses) {
      assert.ok(
        [200, 201].includes(r.status),
        `DEF-P2-01 / F-05 12x concurrent partial settlement must resolve 200/201 (0 HTTP 500 / 0 pool deadlock), got ${r.status}: ${r.text}`,
      );
      assert.ok(
        Number.isSafeInteger(Number(r.data?.entryId)) && Number(r.data.entryId) > 0,
        `DEF-P2-01 response must return non-null entryId, got ${r.text}`,
      );
    }
    const partialEntryIds = new Set(concPartialResponses.map((r) => Number(r.data.entryId)));
    assert.equal(partialEntryIds.size, 1, "DEF-P2-01 / F-05 12x concurrent replay must resolve to a single entryId");
    createdJournalEntryIds.add([...partialEntryIds][0]);

    const [[concAfterPartialRow]] = await pool.execute(
      "SELECT paid_amount, status FROM financial_payables WHERE id = ? LIMIT 1",
      [concPayable.id],
    );
    assert.equal(round2(concAfterPartialRow.paid_amount), 300.0, "DEF-P2-01 concurrent partial settle must set paid_amount === 300 (never 600/900)");
    assert.equal(concAfterPartialRow.status, "partial");

    const [[concJeCount]] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM journal_entries WHERE payable_id = ? AND entry_type = 'ap_settlement' AND is_reversal = FALSE",
      [concPayable.id],
    );
    assert.equal(Number(concJeCount.cnt), 1, "DEF-P2-01 / F-05 must create exactly 1 ap_settlement JE in DB");

    // Mismatched amount / paymentAccountCode on same clientRequestId -> 409
    const mismatchAmtRes = await server.requestJson(`/api/finances/payables/${concPayable.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: { ...concPartialPayload, amount: 400.0 },
    });
    assert.equal(mismatchAmtRes.status, 409, `Mismatched replay amount must reject 409, got ${mismatchAmtRes.status}`);
    const mismatchAccRes = await server.requestJson(`/api/finances/payables/${concPayable.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: { ...concPartialPayload, paymentAccountCode: "1010" },
    });
    assert.equal(mismatchAccRes.status, 409, `Mismatched replay paymentAccountCode must reject 409, got ${mismatchAccRes.status}`);

    // Concurrent Promise.all (12x > connectionLimit: 10) on full remaining settlement (no spurious 409 or pool deadlock on matching replay)
    const concFullKey = randomUUID();
    const concFullPayload = {
      paymentAccountCode: "1030",
      amount: 700.0,
      notes: "Concurrent full remaining settle DEF-P2-01 F-05 12x",
      clientRequestId: concFullKey,
    };
    const concFullResponses = await Promise.all(
      Array.from({ length: 12 }, () =>
        server.requestJson(`/api/finances/payables/${concPayable.id}/settle`, {
          method: "POST",
          token: adminUser.token,
          body: concFullPayload,
        }),
      ),
    );
    assert.equal(concFullResponses.length, 12);
    for (const r of concFullResponses) {
      assert.ok(
        [200, 201].includes(r.status),
        `Concurrent full remaining settlement replay must NOT throw spurious 409, got ${r.status}: ${r.text}`,
      );
      assert.ok(Number.isSafeInteger(Number(r.data?.entryId)) && Number(r.data.entryId) > 0);
    }
    const fullEntryIds = new Set(concFullResponses.map((r) => Number(r.data.entryId)));
    assert.equal(fullEntryIds.size, 1);
    createdJournalEntryIds.add([...fullEntryIds][0]);

    const [[concAfterFullRow]] = await pool.execute(
      "SELECT paid_amount, status FROM financial_payables WHERE id = ? LIMIT 1",
      [concPayable.id],
    );
    assert.equal(round2(concAfterFullRow.paid_amount), 1000.0);
    assert.equal(concAfterFullRow.status, "paid");

    // 5. Restock 1050 on credit (creditAccountCode: "2010") -> creates inventory_restock payable, routes Cash Flow to restockCashOutflow
    const restockItem = await createTestInventoryItem({
      namePrefix: "TalaRestockCredit",
      quantity: 10,
      unit: "pcs",
      purchasePrice: 500,
      packageQuantity: 10,
      packageUnit: "pcs",
      contentsPerPackage: 1,
    });
    const supplierTag = makeUniqueTag("TalaCreditSupplier");
    const restockRes = await server.requestJson(`/api/inventory/${restockItem.id}/restock`, {
      method: "POST",
      token: adminUser.token,
      body: {
        quantity: 6,
        batchCost: 300.0,
        creditAccountCode: "2010",
        supplierName: supplierTag,
        referenceNo: "PO-P2-2010",
      },
    });
    assert.equal(restockRes.status, 200, `Credit restock (2010) failed: ${restockRes.text}`);

    const restockPayablesRes = await server.requestJson(
      "/api/finances/payables?status=open&category=inventory_restock",
      { token: adminUser.token },
    );
    assert.equal(restockPayablesRes.status, 200);
    const restockPayable = (restockPayablesRes.data?.items || []).find(
      (item) => item.vendorName === supplierTag,
    );
    assert.ok(restockPayable, "Restock with creditAccountCode '2010' must auto-create inventory_restock financial_payables row");
    createdPayableIds.add(Number(restockPayable.id));
    assert.equal(restockPayable.billCategory, "inventory_restock");
    assert.equal(restockPayable.liabilityAccountCode, "2010");
    assert.equal(round2(restockPayable.originalAmount), 300.0);

    const cfBeforeRestockSettle = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;

    const settleRestockRes = await server.requestJson(`/api/finances/payables/${restockPayable.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: {
        paymentAccountCode: "1030",
        amount: 300.0,
        notes: "Settling supplier restock payable",
        clientRequestId: randomUUID(),
      },
    });
    assert.ok([200, 201].includes(settleRestockRes.status), `Settling restock AP failed: ${settleRestockRes.text}`);
    const restockSettleJeId = Number(settleRestockRes.data.entryId);
    createdJournalEntryIds.add(restockSettleJeId);

    const cfAfterRestockSettle = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;
    assert.equal(
      round2(
        cfAfterRestockSettle.operatingActivities.restockCashOutflow -
          cfBeforeRestockSettle.operatingActivities.restockCashOutflow,
      ),
      300.0,
      "Settling inventory_restock AP must route Cash Flow to restockCashOutflow",
    );
    assert.equal(
      round2(
        cfAfterRestockSettle.operatingActivities.opexCashOutflow -
          cfBeforeRestockSettle.operatingActivities.opexCashOutflow,
      ),
      0.0,
      "Settling inventory_restock AP must NOT route to opexCashOutflow",
    );

    // DEF-P2-02: Reverse inventory_restock ap_settlement JE -> offsets restockCashOutflow back to 0.00 delta (opexCashOutflow untouched)
    const revRestockSettleRes = await server.requestJson(`/api/finances/journal-entries/${restockSettleJeId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "DEF-P2-02 reverse supplier restock settlement" },
    });
    assert.equal(revRestockSettleRes.status, 201, `Reversing restock ap_settlement failed: ${revRestockSettleRes.text}`);
    createdJournalEntryIds.add(Number(revRestockSettleRes.data.reversalEntryId));

    const cfAfterRestockSettleRev = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;
    assert.equal(
      round2(
        cfAfterRestockSettleRev.operatingActivities.restockCashOutflow -
          cfBeforeRestockSettle.operatingActivities.restockCashOutflow,
      ),
      0.0,
      "DEF-P2-02: Reversing inventory_restock ap_settlement must offset restockCashOutflow back to 0.00 net change",
    );
    assert.equal(
      round2(
        cfAfterRestockSettleRev.operatingActivities.opexCashOutflow -
          cfBeforeRestockSettle.operatingActivities.opexCashOutflow,
      ),
      0.0,
      "DEF-P2-02: Reversing inventory_restock ap_settlement must leave opexCashOutflow untouched",
    );

    // Manual POST /journal-entries ap_settlement exceeding untracked GL balance -> 409
    const payablesTotalsRes = await server.requestJson("/api/finances/payables?status=open", {
      token: adminUser.token,
    });
    const totals = payablesTotalsRes.data?.totals || {};
    const untrackedAp2010 = round2(Math.max(0, Number(totals.glAp2010Balance || 0) - Number(totals.unpaidAp2010 || 0)));
    const manualTrackedApRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "ap_settlement",
        amount: round2(untrackedAp2010 + 50.0),
        debitAccountCode: "2010",
        creditAccountCode: "1030",
        memo: "Manual ap_settlement exceeding untracked GL balance",
      },
    });
    assert.equal(
      manualTrackedApRes.status,
      409,
      `Manual ap_settlement exceeding untracked 2010 GL balance must reject with HTTP 409, got ${manualTrackedApRes.status}: ${manualTrackedApRes.text}`,
    );
  });

  // --------------------------------------------------------------------------
  // P2-3: STAFF MEALS 6113, EXPANDED INTERNAL-USE, CONCURRENT REPLAY, GL BLOCK 409 & INVENTORY REVERSAL
  // --------------------------------------------------------------------------
  it("P2-3 (Staff Meals 6113 & Internal-Use Hardening): accepts 6113/6133/6141-6143, rejects 6030/4010/6210/6310, handles concurrent Promise.all idempotency, blocks GL-only reversal (409), and reverses via /internal-use/:movementId/reverse", async () => {
    const supply = await createTestInventoryItem({
      namePrefix: "TalaP2StoreUse",
      quantity: 1000,
      unit: "g",
      purchasePrice: 200,
      packageQuantity: 1,
      packageUnit: "pack",
      contentsPerPackage: 1000, // ₱0.20/g
    });

    // Reject disallowed codes with 400
    for (const badCode of ["6030", "4010", "6210", "6310"]) {
      const badRes = await server.requestJson(`/api/inventory/${supply.id}/internal-use`, {
        method: "POST",
        token: adminUser.token,
        body: { quantity: 10, expenseAccountCode: badCode, note: `Disallow ${badCode}` },
      });
      assert.equal(
        badRes.status,
        400,
        `Internal-use with disallowed code '${badCode}' must reject with HTTP 400, got ${badRes.status}: ${badRes.text}`,
      );
    }

    // Accept expanded Phase 2 internal-use accounts: 6133, 6141, 6142, 6143
    for (const validCode of ["6133", "6141", "6142", "6143"]) {
      const okRes = await server.requestJson(`/api/inventory/${supply.id}/internal-use`, {
        method: "POST",
        token: adminUser.token,
        body: {
          quantity: 10,
          expenseAccountCode: validCode,
          note: `Valid Phase 2 internal use ${validCode}`,
          clientRequestId: randomUUID(),
        },
      });
      assert.ok(
        [200, 201].includes(okRes.status),
        `Internal-use with '${validCode}' must succeed with 200/201, got ${okRes.status}: ${okRes.text}`,
      );
    }

    // Staff Meals (6113): hits Labor & Payroll OPEX with zero 6030 food spoilage
    const pnlBefore = (
      await server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;

    const mealRes = await server.requestJson(`/api/inventory/${supply.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: {
        quantity: 100, // 100g * ₱0.20 = ₱20.00
        expenseAccountCode: "6113",
        note: "Afternoon crew meal chicken",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(mealRes.status, 201, `Staff meals (6113) internal-use failed: ${mealRes.text}`);
    const mealMoveId = Number(mealRes.data.movementId ?? mealRes.data.id);
    const mealJeId = Number(mealRes.data.journalEntryId);
    assert.ok(Number.isSafeInteger(mealMoveId) && mealMoveId > 0);
    assert.ok(Number.isSafeInteger(mealJeId) && mealJeId > 0);
    createdJournalEntryIds.add(mealJeId);

    const pnlAfterMeal = (
      await server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;
    const row6113 = (pnlAfterMeal.operatingExpenses || []).find((r) => r.accountCode === "6113");
    assert.ok(row6113, "P&L operatingExpenses must include 6113 Staff Meals");
    assert.equal(row6113.expenseGroup, "Labor & Payroll", "6113 must roll into 'Labor & Payroll' OPEX group");
    assert.equal(round2(row6113.amount), 20.0);
    assert.equal(
      round2(pnlAfterMeal.foodSpoilageCogs),
      round2(pnlBefore.foodSpoilageCogs),
      "Staff Meals (6113) must NEVER increase 6030 foodSpoilageCogs",
    );

    // Direct GL reversal on an inventory_movement_id entry must reject 409
    const glRevBlockRes = await server.requestJson(`/api/finances/journal-entries/${mealJeId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Blocked direct GL reversal on inventory movement" },
    });
    assert.equal(
      glRevBlockRes.status,
      409,
      `Direct GL reversal of inventory_movement_id entry must reject with HTTP 409, got ${glRevBlockRes.status}: ${glRevBlockRes.text}`,
    );

    // Staff RBAC on POST /api/inventory/internal-use/:movementId/reverse -> 403
    const staffInvRevRes = await server.requestJson(`/api/inventory/internal-use/${mealMoveId}/reverse`, {
      method: "POST",
      token: staffUser.token,
      body: { reason: "Staff unauthorized reversal attempt" },
    });
    assert.equal(staffInvRevRes.status, 403, `Staff internal-use reverse must reject 403, got ${staffInvRevRes.status}`);

    // Reverse internal-use atomically via POST /api/inventory/internal-use/:movementId/reverse
    const invRevRes = await server.requestJson(`/api/inventory/internal-use/${mealMoveId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Crew meal logged twice by mistake" },
    });
    assert.ok(
      [200, 201].includes(invRevRes.status),
      `POST /api/inventory/internal-use/${mealMoveId}/reverse must succeed, got ${invRevRes.status}: ${invRevRes.text}`,
    );

    // Double reversal must reject with 409
    const doubleInvRevRes = await server.requestJson(`/api/inventory/internal-use/${mealMoveId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Duplicate internal-use reversal attempt" },
    });
    assert.equal(
      doubleInvRevRes.status,
      409,
      `Second reversal of internal-use movement must reject with 409, got ${doubleInvRevRes.status}: ${doubleInvRevRes.text}`,
    );

    const [[afterRevItem]] = await pool.execute(
      "SELECT quantity FROM inventory_items WHERE id = ? LIMIT 1",
      [supply.id],
    );
    // 1000 - 40 (four 10g ops) - 100 (meal) + 100 (reversed) = 960
    assert.equal(Number(afterRevItem.quantity), 960, "Reversing internal-use must restore stock quantity (860 -> 960)");

    const [[revJeRow]] = await pool.execute(
      "SELECT id, entry_type, is_reversal FROM journal_entries WHERE reverses_entry_id = ? LIMIT 1",
      [mealJeId],
    );
    assert.ok(revJeRow, "Inventory internal-use reversal must post linked GL void_reversal");
    assert.equal(revJeRow.entry_type, "void_reversal");
    assert.equal(revJeRow.is_reversal, 1);
    createdJournalEntryIds.add(Number(revJeRow.id));

    // 1050 valuation parity after an intermediate restock before reversal
    const valItem = await createTestInventoryItem({
      namePrefix: "TalaP2ValParity",
      quantity: 10,
      unit: "pcs",
      purchasePrice: 500,
      packageQuantity: 10,
      packageUnit: "pcs",
      contentsPerPackage: 1, // ₱50.00/pc -> ₱500.00 total
    });
    const valUseRes = await server.requestJson(`/api/inventory/${valItem.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: {
        quantity: 2, // 2 * ₱50 = ₱100.00
        expenseAccountCode: "6113",
        note: "Staff meal before intermediate restock",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(valUseRes.status, 201);
    const valMoveId = Number(valUseRes.data.movementId ?? valUseRes.data.id);
    createdJournalEntryIds.add(Number(valUseRes.data.journalEntryId));

    const valRestockRes = await server.requestJson(`/api/inventory/${valItem.id}/restock`, {
      method: "POST",
      token: adminUser.token,
      body: {
        quantity: 8,
        batchCost: 640.0, // ₱80.00/pc -> 16 pcs total ₱1040.00 (₱65.00/pc weighted avg)
        creditAccountCode: "1030",
        supplierName: "Intermediate Valuation Supplier",
      },
    });
    assert.equal(valRestockRes.status, 200);

    const bsBeforeValRev = (await server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token })).data;
    const revValRes = await server.requestJson(`/api/inventory/internal-use/${valMoveId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Reverse after intermediate restock" },
    });
    assert.equal(revValRes.status, 200, `Reversal after intermediate restock failed: ${revValRes.text}`);

    const bsAfterValRev = (await server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token })).data;
    const [[dbValItem]] = await pool.execute(
      "SELECT quantity, unit_cost FROM inventory_items WHERE id = ? LIMIT 1",
      [valItem.id],
    );
    assert.equal(Number(dbValItem.quantity), 18);
    assert.equal(round2(Number(dbValItem.quantity) * Number(dbValItem.unit_cost)), 1140.0, "Weighted avg value must restore original ₱100.00 batch cost (1040 + 100 = 1140)");
    assert.equal(
      round2(bsAfterValRev.ledgerInventoryValue - bsBeforeValRev.ledgerInventoryValue),
      100.0,
      "GL 1050 must increase by exact ₱100.00 on internal-use reversal after intermediate restock",
    );
    assert.equal(
      round2(bsAfterValRev.liveInventoryValue - bsBeforeValRev.liveInventoryValue),
      100.0,
      "Live inventory subledger value must match +₱100.00 GL 1050 restoration",
    );
    assert.equal(
      round2(bsAfterValRev.inventoryValuationVariance),
      round2(bsBeforeValRev.inventoryValuationVariance),
      "1050 GL <-> subledger valuation variance must remain strictly unchanged across intermediate restock + reversal",
    );

    // Concurrent Promise.all replay with identical clientRequestId deducts stock exactly once
    const concurrentItem = await createTestInventoryItem({
      namePrefix: "TalaP2ConcurrentUse",
      quantity: 10,
      unit: "pcs",
      purchasePrice: 500,
      packageQuantity: 10,
      packageUnit: "pcs",
      contentsPerPackage: 1, // ₱50/pc
    });
    const sharedKey = randomUUID();
    const concurrentPayload = {
      quantity: 2,
      expenseAccountCode: "6113",
      note: "Concurrent idempotent staff meal",
      clientRequestId: sharedKey,
    };

    const concurrentResponses = await Promise.all([
      server.requestJson(`/api/inventory/${concurrentItem.id}/internal-use`, {
        method: "POST",
        token: adminUser.token,
        body: concurrentPayload,
      }),
      server.requestJson(`/api/inventory/${concurrentItem.id}/internal-use`, {
        method: "POST",
        token: adminUser.token,
        body: concurrentPayload,
      }),
      server.requestJson(`/api/inventory/${concurrentItem.id}/internal-use`, {
        method: "POST",
        token: adminUser.token,
        body: concurrentPayload,
      }),
    ]);

    for (const r of concurrentResponses) {
      assert.ok(
        [200, 201].includes(r.status),
        `Concurrent identical clientRequestId replay must return 200/201 (no deadlock/500), got ${r.status}: ${r.text}`,
      );
    }
    const uniqueMoveIds = new Set(concurrentResponses.map((r) => Number(r.data.movementId ?? r.data.id)));
    assert.equal(uniqueMoveIds.size, 1, "All concurrent replays must resolve to the same single movementId");

    const [[afterConcurrentItem]] = await pool.execute(
      "SELECT quantity FROM inventory_items WHERE id = ? LIMIT 1",
      [concurrentItem.id],
    );
    assert.equal(Number(afterConcurrentItem.quantity), 8, "Concurrent replay must deduct stock exactly once (10 -> 8)");

    // Replay with same clientRequestId & mismatched expenseAccountCode must reject 409
    const mismatchRes = await server.requestJson(`/api/inventory/${concurrentItem.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: {
        ...concurrentPayload,
        expenseAccountCode: "6133",
      },
    });
    assert.equal(
      mismatchRes.status,
      409,
      `Reusing clientRequestId with mismatched expenseAccountCode must reject 409, got ${mismatchRes.status}: ${mismatchRes.text}`,
    );
  });

  // --------------------------------------------------------------------------
  // P2-4: NON-CASH DEPRECIATION 6210 / 1520, 1510 - 1520 EQUILIBRIUM, NBV CAP, ZERO CASH FLOW, SNAPSHOT
  // --------------------------------------------------------------------------
  it("P2-4 (Depreciation 6210 / 1520 & NBV Equilibrium): updates P&L waterfall, BS 1520 contra netting, baseCapitalMoney invariance, zero cash flow, session closing_non_current_assets, and 400/409 guards", async () => {
    const accBefore = (await server.requestJson("/api/finances/accounts", { token: adminUser.token })).data;
    const bsBefore = (await server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token })).data;
    const beforeEquip = round2(accBefore.summary.nonCurrentEquipment || 0);
    const beforeAccum = findAccountBalance(bsBefore, "asset", "1520");

    // Post opening 1510 Equipment ₱10,000
    const openEquipRes = await server.requestJson("/api/finances/opening-balance", {
      method: "POST",
      token: adminUser.token,
      body: {
        equipment: 10000.0,
        notes: "Tala P2-4 Espresso & Kitchen Equipment",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(openEquipRes.status, 201, `Opening equipment post failed: ${openEquipRes.text}`);
    createdJournalEntryIds.add(Number(openEquipRes.data.entryId));

    const [pnlBeforeDeprRes, accAfterOpenRes, cfBeforeDeprRes] = await Promise.all([
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson("/api/finances/accounts", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
    ]);
    const pnlBeforeDepr = pnlBeforeDeprRes.data;
    const accAfterOpen = accAfterOpenRes.data;
    const cfBeforeDepr = cfBeforeDeprRes.data;

    // Post non-cash depreciation: DR 6210 / CR 1520 ₱500
    const deprRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "depreciation",
        amount: 500.0,
        debitAccountCode: "6210",
        creditAccountCode: "1520",
        memo: "Monthly equipment depreciation P2-4",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(deprRes.status, 201, `Depreciation post failed: ${deprRes.text}`);
    createdJournalEntryIds.add(Number(deprRes.data.entryId));

    const [pnlAfterDeprRes, bsAfterDeprRes, accAfterDeprRes, cfAfterDeprRes] = await Promise.all([
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
      server.requestJson("/api/finances/accounts", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
    ]);
    const pnlAfter = pnlAfterDeprRes.data;
    const bsAfter = bsAfterDeprRes.data;
    const accAfterDepr = accAfterDeprRes.data;
    const cfAfterDepr = cfAfterDeprRes.data;

    // P&L waterfall
    assert.equal(
      round2(pnlAfter.ebitdaOperatingIncome),
      round2(pnlBeforeDepr.ebitdaOperatingIncome),
      "Depreciation must NOT alter ebitdaOperatingIncome",
    );
    assert.equal(round2(pnlAfter.depreciation - pnlBeforeDepr.depreciation), 500.0, "P&L depreciation must equal ₱500.00");
    assert.equal(typeof pnlAfter.netIncomeBeforeTax, "number", "P&L must expose numeric netIncomeBeforeTax");
    assert.equal(typeof pnlAfter.netIncome, "number", "P&L must expose numeric netIncome");
    assert.equal(
      round2(pnlAfter.netIncomeBeforeTax),
      round2(pnlAfter.ebitdaOperatingIncome - pnlAfter.depreciation),
      "netIncomeBeforeTax must equal ebitdaOperatingIncome - depreciation",
    );
    assert.equal(
      round2(pnlAfter.netIncome),
      round2(pnlAfter.netIncomeBeforeTax - pnlAfter.tax),
      "netIncome must equal netIncomeBeforeTax - tax",
    );

    // Balance Sheet 1520 contra-asset netting & equilibrium
    assert.equal(bsAfter.isBalanced, true, "Balance Sheet must remain balanced after depreciation");
    assert.equal(round2(bsAfter.balanceDifference), 0);
    const line1520 = (bsAfter.assets?.nonCurrent || []).find((a) => a.accountCode === "1520");
    assert.ok(line1520, "Balance Sheet assets.nonCurrent must include contra-asset 1520");
    assert.equal(line1520.isContra, true, "Balance Sheet 1520 line must carry isContra: true");
    assert.equal(round2(line1520.amount - beforeAccum), 500.0);

    const netEquipmentVal = bsAfter.assets?.netEquipment ?? bsAfter.netEquipment;
    assert.equal(
      round2(netEquipmentVal - beforeEquip),
      9500.0,
      "Net Equipment (1510 - 1520) must equal ₱9,500.00 above baseline",
    );
    assert.equal(
      round2(accAfterDepr.summary.nonCurrentEquipment - beforeEquip),
      9500.0,
      "/accounts summary.nonCurrentEquipment must reflect 1510 - 1520 netting",
    );
    assert.equal(
      round2(accAfterDepr.summary.baseCapitalMoney),
      round2(accAfterOpen.summary.baseCapitalMoney),
      "/accounts baseCapitalMoney must stay invariant across non-cash depreciation",
    );
    assert.equal(
      round2(cfAfterDepr.netCashFlow - cfBeforeDepr.netCashFlow),
      0.0,
      "Non-cash depreciation must produce zero cash flow",
    );

    // Shift open/close snapshot closing_non_current_assets === 1510 - 1520 (9500 above baseline)
    const openSnapRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staffUser.token,
      body: { openingFloat: 500.0, terminalLabel: "Tala P2-4 Snap Reg" },
    });
    assert.equal(openSnapRes.status, 201);
    const snapSessionId = Number(openSnapRes.data.session.id);
    tracker.sessionIds.add(snapSessionId);

    const closeSnapRes = await server.requestJson(`/api/sessions/${snapSessionId}/close`, {
      method: "POST",
      token: staffUser.token,
      body: { countedCash: 500.0, closingNotes: "P2-4 snapshot NBV test" },
    });
    assert.equal(closeSnapRes.status, 200);

    const [[snapRow]] = await pool.execute(
      "SELECT closing_non_current_assets FROM store_daily_asset_snapshots WHERE business_date = ? LIMIT 1",
      [today],
    );
    assert.ok(snapRow, "Daily snapshot must exist after closing shift");
    assert.equal(
      round2(Number(snapRow.closing_non_current_assets) - beforeEquip),
      9500.0,
      "Snapshot closing_non_current_assets must net 1510 - 1520 (₱9,500.00)",
    );

    // Reject DR 6210 / CR 1010 with 400
    const cashDeprRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "depreciation",
        amount: 100.0,
        debitAccountCode: "6210",
        creditAccountCode: "1010",
        memo: "Invalid cash depreciation",
      },
    });
    assert.equal(
      cashDeprRes.status,
      400,
      `DR 6210 / CR 1010 must reject with HTTP 400, got ${cashDeprRes.status}: ${cashDeprRes.text}`,
    );

    // Reject depreciation > NBV (1510 - 1520) with 409
    const overDeprRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "depreciation",
        amount: round2(Number(netEquipmentVal) + 100.0),
        debitAccountCode: "6210",
        creditAccountCode: "1520",
        memo: "Over-NBV depreciation attempt",
      },
    });
    assert.equal(
      overDeprRes.status,
      409,
      `Depreciation exceeding NBV (1510 - 1520) must reject with HTTP 409, got ${overDeprRes.status}: ${overDeprRes.text}`,
    );

    // Reject 6210/1520 with wrong entryType ('adjustment') -> 400
    const wrongTypeDeprRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "adjustment",
        amount: 100.0,
        debitAccountCode: "6210",
        creditAccountCode: "1520",
        memo: "Wrong entryType for depreciation accounts",
      },
    });
    assert.equal(
      wrongTypeDeprRes.status,
      400,
      `Posting 6210/1520 with entryType 'adjustment' must reject with 400, got ${wrongTypeDeprRes.status}: ${wrongTypeDeprRes.text}`,
    );

    // Concurrent Promise.all (2x) depreciation totaling > NBV permits only 1 (201) and rejects 2nd (409)
    const halfPlusNbv = round2(Number(netEquipmentVal) * 0.6);
    const [concDepr1, concDepr2] = await Promise.all([
      server.requestJson("/api/finances/journal-entries", {
        method: "POST",
        token: adminUser.token,
        body: {
          entryType: "depreciation",
          amount: halfPlusNbv,
          debitAccountCode: "6210",
          creditAccountCode: "1520",
          memo: "Concurrent NBV cap race A",
          clientRequestId: randomUUID(),
        },
      }),
      server.requestJson("/api/finances/journal-entries", {
        method: "POST",
        token: adminUser.token,
        body: {
          entryType: "depreciation",
          amount: halfPlusNbv,
          debitAccountCode: "6210",
          creditAccountCode: "1520",
          memo: "Concurrent NBV cap race B",
          clientRequestId: randomUUID(),
        },
      }),
    ]);
    const concDeprStatuses = [concDepr1.status, concDepr2.status].sort((a, b) => a - b);
    assert.deepEqual(
      concDeprStatuses,
      [201, 409],
      `Concurrent 2x depreciation exceeding NBV must permit 1 (201) and reject 1 (409), got [${concDepr1.status}, ${concDepr2.status}]`,
    );
    const winningConcDepr = concDepr1.status === 201 ? concDepr1 : concDepr2;
    const winningConcDeprId = Number(winningConcDepr.data.entryId);
    createdJournalEntryIds.add(winningConcDeprId);

    // Reversing depreciation JEs restores netEquipment & depreciation === 0
    for (const deprId of [Number(deprRes.data.entryId), winningConcDeprId]) {
      const revDeprRes = await server.requestJson(`/api/finances/journal-entries/${deprId}/reverse`, {
        method: "POST",
        token: adminUser.token,
        body: { reason: "Restore equipment NBV after depreciation reversal" },
      });
      assert.equal(revDeprRes.status, 201, `Reversing depreciation JE #${deprId} failed: ${revDeprRes.text}`);
      createdJournalEntryIds.add(Number(revDeprRes.data.reversalEntryId));
    }

    const [pnlAfterDeprRevRes, bsAfterDeprRevRes] = await Promise.all([
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
    ]);
    assert.equal(
      round2(pnlAfterDeprRevRes.data.depreciation),
      round2(pnlBeforeDepr.depreciation),
      "Reversing depreciation JEs must restore P&L depreciation back to baseline (0)",
    );
    const restoredNetEquipment = bsAfterDeprRevRes.data.assets?.netEquipment ?? bsAfterDeprRevRes.data.netEquipment;
    assert.equal(
      round2(restoredNetEquipment - beforeEquip),
      10000.0,
      "Reversing depreciation JEs must restore Balance Sheet netEquipment back to opening ₱10,000.00",
    );
  });

  // --------------------------------------------------------------------------
  // P2-5: INCOME TAX 6310 & 2030 ISOLATED FROM 2020 VAT, P&L WATERFALL
  // --------------------------------------------------------------------------
  it("P2-5 (Income Tax 6310 / 2030 & 2020 VAT Isolation): preserves 2020 VAT on order, reduces netIncome only, settles 2030 to taxCashOutflow without double-counting tax, and blocks manual 2020 entries (400)", async () => {
    await updateSettings({ vatEnabled: true, vatRatePercent: 12, enforceShiftGate: false });
    const beans = await createTestInventoryItem({
      namePrefix: "TalaP2TaxBeans",
      quantity: 500,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bag",
      contentsPerPackage: 500,
    });
    const product = await createTestMenuProduct({
      namePrefix: "TalaP2TaxLatte",
      basePrice: 100,
      inventoryItem: beans,
      quantityUsed: 100,
      unit: "g",
    });

    const bsBeforeOrder = (await server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token })).data;
    const vatBeforeOrder = findAccountBalance(bsBeforeOrder, "liability", "2020");

    const orderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: adminUser.token,
      body: {
        customerName: "Tala P2 VAT Isolation Customer",
        type: "Takeout",
        paymentMethod: "Cash",
        items: [{ productId: product.id, quantity: 1, size: "Regular" }],
      },
    });
    assert.equal(orderRes.status, 201, `VAT order setup failed: ${orderRes.text}`);
    tracker.orderIds.add(Number(orderRes.data.id));

    const [bsAfterVatRes, pnlBeforeTaxRes, cfBeforeTaxRes] = await Promise.all([
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
    ]);
    const vatBalance = findAccountBalance(bsAfterVatRes.data, "liability", "2020");
    assert.equal(round2(vatBalance - vatBeforeOrder), 12.0, "Order must credit 2020 VAT Payable by ₱12.00");

    const pnlBeforeTax = pnlBeforeTaxRes.data;
    const cfBeforeTax = cfBeforeTaxRes.data;
    const tax2030Before = findAccountBalance(bsAfterVatRes.data, "liability", "2030");

    // Post unpaid income tax: DR 6310 / CR 2030 ₱300
    const taxAccrualRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "income_tax",
        amount: 300.0,
        debitAccountCode: "6310",
        creditAccountCode: "2030",
        vendorName: "BIR Income Tax Q4",
        dueDate: today,
        memo: "Unpaid business income tax P2-5",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(taxAccrualRes.status, 201, `Unpaid income_tax (DR 6310 / CR 2030) failed: ${taxAccrualRes.text}`);
    const taxEntryId = Number(taxAccrualRes.data.entryId);
    createdJournalEntryIds.add(taxEntryId);

    const [bsAfterTaxRes, pnlAfterTaxRes, cfAfterTaxRes, payablesTaxRes] = await Promise.all([
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson("/api/finances/payables?status=open&category=income_tax", { token: adminUser.token }),
    ]);
    assert.equal(bsAfterTaxRes.data.isBalanced, true);
    assert.equal(
      findAccountBalance(bsAfterTaxRes.data, "liability", "2020"),
      vatBalance,
      "2020 VAT Payable must remain completely isolated from 2030 Income Tax",
    );
    assert.equal(
      round2(findAccountBalance(bsAfterTaxRes.data, "liability", "2030") - tax2030Before),
      300.0,
      "2030 Income Tax Payable must increase by ₱300.00",
    );
    assert.equal(
      round2(pnlAfterTaxRes.data.tax - pnlBeforeTax.tax),
      300.0,
      "P&L tax must increase by ₱300.00",
    );
    assert.equal(
      round2(pnlAfterTaxRes.data.netIncomeBeforeTax),
      round2(pnlBeforeTax.netIncomeBeforeTax),
      "Income Tax must NOT change netIncomeBeforeTax",
    );
    assert.equal(
      round2(pnlAfterTaxRes.data.netIncome),
      round2(pnlAfterTaxRes.data.netIncomeBeforeTax - pnlAfterTaxRes.data.tax),
      "netIncome must equal netIncomeBeforeTax - tax",
    );
    assert.equal(
      round2(cfAfterTaxRes.data.netCashFlow - cfBeforeTax.netCashFlow),
      0.0,
      "Unpaid 2030 income_tax accrual must produce zero cash flow",
    );

    const taxPayable = (payablesTaxRes.data?.items || []).find(
      (item) => Number(item.incurredJournalEntryId) === taxEntryId,
    );
    assert.ok(taxPayable, "GET /api/finances/payables must expose open 2030 income_tax payable");
    createdPayableIds.add(Number(taxPayable.id));

    // Settle 2030 payable via 1030 Bank
    const settleTaxRes = await server.requestJson(`/api/finances/payables/${taxPayable.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: {
        paymentAccountCode: "1030",
        amount: 300.0,
        notes: "Paid BIR income tax via bank",
        clientRequestId: randomUUID(),
      },
    });
    assert.ok([200, 201].includes(settleTaxRes.status), `Settling 2030 tax payable failed: ${settleTaxRes.text}`);

    const [bsSettledRes, pnlSettledRes, cfSettledRes] = await Promise.all([
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
    ]);
    assert.equal(bsSettledRes.data.isBalanced, true);
    assert.equal(
      findAccountBalance(bsSettledRes.data, "liability", "2030"),
      tax2030Before,
      "2030 Income Tax Payable must return to baseline after full settlement",
    );
    assert.equal(
      findAccountBalance(bsSettledRes.data, "liability", "2020"),
      vatBalance,
      "2020 VAT Payable must remain untouched by 2030 settlement",
    );
    assert.equal(
      round2(cfSettledRes.data.operatingActivities.taxCashOutflow - (cfBeforeTax.operatingActivities.taxCashOutflow || 0)),
      300.0,
      "Settling 2030 tax payable must route ₱300.00 to operatingActivities.taxCashOutflow",
    );
    assert.equal(
      round2(pnlSettledRes.data.tax),
      round2(pnlAfterTaxRes.data.tax),
      "Settling 2030 tax payable must NOT double-count P&L tax",
    );

    // Reversing a 2030 ap_settlement reopens 2030 payable and offsets taxCashOutflow on Cash Flow
    const taxSettleJeId = Number(settleTaxRes.data.entryId);
    createdJournalEntryIds.add(taxSettleJeId);
    const revTaxSettleRes = await server.requestJson(`/api/finances/journal-entries/${taxSettleJeId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Reverse 2030 income tax settlement" },
    });
    assert.equal(revTaxSettleRes.status, 201, `Reversing 2030 ap_settlement failed: ${revTaxSettleRes.text}`);
    createdJournalEntryIds.add(Number(revTaxSettleRes.data.reversalEntryId));

    const [reopenedTaxPayablesRes, bsTaxRevRes, cfTaxRevRes] = await Promise.all([
      server.requestJson("/api/finances/payables?status=open&category=income_tax", { token: adminUser.token }),
      server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token }),
    ]);
    const reopenedTaxPayable = (reopenedTaxPayablesRes.data?.items || []).find(
      (item) => Number(item.id) === Number(taxPayable.id),
    );
    assert.ok(reopenedTaxPayable, "Reversing 2030 ap_settlement must reopen 2030 payable into open payables list");
    assert.equal(reopenedTaxPayable.status, "unpaid");
    assert.equal(round2(reopenedTaxPayable.paidAmount), 0.0);
    assert.equal(
      round2(findAccountBalance(bsTaxRevRes.data, "liability", "2030") - tax2030Before),
      300.0,
      "Reversing 2030 ap_settlement must restore 2030 Income Tax Payable balance (+₱300.00)",
    );
    assert.equal(
      round2(cfTaxRevRes.data.operatingActivities.taxCashOutflow - (cfBeforeTax.operatingActivities.taxCashOutflow || 0)),
      0.0,
      "Reversing 2030 ap_settlement must offset taxCashOutflow back to baseline",
    );

    // Manual journal entries touching 2020 must reject 400
    for (const attempt of [
      { entryType: "income_tax", amount: 50, debitAccountCode: "6310", creditAccountCode: "2020", memo: "Bad 2020 tax credit" },
      { entryType: "adjustment", amount: 10, debitAccountCode: "2020", creditAccountCode: "1010", memo: "Bad 2020 manual debit" },
    ]) {
      const bad2020Res = await server.requestJson("/api/finances/journal-entries", {
        method: "POST",
        token: adminUser.token,
        body: attempt,
      });
      assert.equal(
        bad2020Res.status,
        400,
        `Manual POST /journal-entries touching 2020 must reject with HTTP 400, got ${bad2020Res.status}: ${bad2020Res.text}`,
      );
    }

    await updateSettings({ vatEnabled: false });
  });

  // --------------------------------------------------------------------------
  // P2-6: CASH FLOW COUNTERPART PARITY (-2X 1510 BUG) & SHIFT EXPECTED CASH ON 1010 PAYOUTS
  // --------------------------------------------------------------------------
  it("P2-6 (Cash Flow Counterpart Parity & Shift expectedCash): fixes -2X 1510 bug, keeps account_transfer cash-neutral, routes capital_injection reversal to financing, preserves netCashFlow === liquid delta, and deducts 1010 payouts from shift expectedCash", async () => {
    const cfBefore = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;

    // 1. Cash equipment purchase DR 1510 / CR 1010 ₱2,000 -> investing -2000 ONLY (not -4000!)
    const equipCashRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "adjustment",
        amount: 2000.0,
        debitAccountCode: "1510",
        creditAccountCode: "1010",
        memo: "Cash purchase of espresso grinder P2-6",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(equipCashRes.status, 201, `Cash equipment purchase failed: ${equipCashRes.text}`);
    createdJournalEntryIds.add(Number(equipCashRes.data.entryId));

    const cfAfterEquip = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;
    assert.equal(
      round2(cfAfterEquip.investingActivities.netInvestingCashFlow - cfBefore.investingActivities.netInvestingCashFlow),
      -2000.0,
      "Cash equipment purchase must record investingCashFlow delta of -2000",
    );
    assert.equal(
      round2(cfAfterEquip.operatingActivities.netOperatingCashFlow - cfBefore.operatingActivities.netOperatingCashFlow),
      0.0,
      "Cash equipment purchase must NOT leak into operatingCashFlow (-2X bug)",
    );
    assert.equal(
      round2(cfAfterEquip.netCashFlow - cfBefore.netCashFlow),
      -2000.0,
      "netCashFlow delta for ₱2,000 cash equipment purchase must be -2000 (not -4000)",
    );

    // 2. account_transfer 1010 -> 1030 yields 0 netCashFlow change
    const transferRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "account_transfer",
        amount: 750.0,
        debitAccountCode: "1030",
        creditAccountCode: "1010",
        memo: "Transfer drawer cash to bank P2-6",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(transferRes.status, 201, `account_transfer failed: ${transferRes.text}`);
    createdJournalEntryIds.add(Number(transferRes.data.entryId));

    const cfAfterTransfer = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;
    assert.equal(
      round2(cfAfterTransfer.netCashFlow),
      round2(cfAfterEquip.netCashFlow),
      "account_transfer between 1010 and 1030 must be cash-neutral",
    );

    // 3. Reversing capital_injection hits financingCashFlow (NOT otherOperatingCashNet)
    const capRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "capital_injection",
        amount: 1000.0,
        debitAccountCode: "1030",
        creditAccountCode: "3010",
        memo: "Owner injection for reversal parity test",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(capRes.status, 201);
    const capJeId = Number(capRes.data.entryId);
    createdJournalEntryIds.add(capJeId);

    const cfBeforeCapRev = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;

    const revCapRes = await server.requestJson(`/api/finances/journal-entries/${capJeId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Reverse capital injection for cash flow routing parity" },
    });
    assert.equal(revCapRes.status, 201);
    createdJournalEntryIds.add(Number(revCapRes.data.reversalEntryId));

    const cfAfterCapRev = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;
    assert.equal(
      round2(
        cfAfterCapRev.financingActivities.netFinancingCashFlow -
          cfBeforeCapRev.financingActivities.netFinancingCashFlow,
      ),
      -1000.0,
      "Reversing capital_injection must hit financingCashFlow (-1000)",
    );
    assert.equal(
      round2(cfAfterCapRev.operatingActivities.otherOperatingCashNet),
      round2(cfBeforeCapRev.operatingActivities.otherOperatingCashNet),
      "Reversing capital_injection must NOT leak into operatingActivities.otherOperatingCashNet",
    );

    // 4. Open shift and make 1010 payouts (OPEX + AP settlement + Income Tax) -> expectedCash matches exact drawer count
    const openShiftRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: adminUser.token,
      body: { openingFloat: 5000.0, terminalLabel: "Tala P2-6 Drawer Payout Reg" },
    });
    assert.equal(openShiftRes.status, 201, `Open shift failed: ${openShiftRes.text}`);
    const shiftId = Number(openShiftRes.data.session.id);
    tracker.sessionIds.add(shiftId);

    // 4a. Paid OPEX from 1010 (₱400)
    const drawerOpexRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        amount: 400.0,
        debitAccountCode: "6131",
        creditAccountCode: "1010",
        memo: "Shift drawer electricity payout",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(drawerOpexRes.status, 201);
    createdJournalEntryIds.add(Number(drawerOpexRes.data.entryId));

    // 4b. Unpaid OPEX bill (₱250) settled from 1010
    const billForDrawerRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        amount: 250.0,
        debitAccountCode: "6171",
        creditAccountCode: "2010",
        memo: "Shift office bill to settle from drawer",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(billForDrawerRes.status, 201);
    const billForDrawerJeId = Number(billForDrawerRes.data.entryId);
    createdJournalEntryIds.add(billForDrawerJeId);

    const openBillsRes = await server.requestJson("/api/finances/payables?status=open&category=opex", {
      token: adminUser.token,
    });
    const drawerBill = (openBillsRes.data?.items || []).find(
      (item) => Number(item.incurredJournalEntryId) === billForDrawerJeId,
    );
    assert.ok(drawerBill, "Unpaid bill created during shift must exist in payables");
    createdPayableIds.add(Number(drawerBill.id));

    const drawerSettleRes = await server.requestJson(`/api/finances/payables/${drawerBill.id}/settle`, {
      method: "POST",
      token: adminUser.token,
      body: {
        paymentAccountCode: "1010",
        amount: 250.0,
        notes: "Paid bill from counter cash drawer",
        clientRequestId: randomUUID(),
      },
    });
    assert.ok([200, 201].includes(drawerSettleRes.status));

    // 4c. Paid Income Tax from 1010 (₱150)
    const drawerTaxRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "income_tax",
        amount: 150.0,
        debitAccountCode: "6310",
        creditAccountCode: "1010",
        memo: "Shift drawer income tax payment",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(drawerTaxRes.status, 201);
    createdJournalEntryIds.add(Number(drawerTaxRes.data.entryId));

    const currentShiftRes = await server.requestJson("/api/sessions/current", { token: adminUser.token });
    assert.equal(currentShiftRes.status, 200);
    assert.equal(
      round2(currentShiftRes.data.session?.expectedCash),
      4200.0,
      "Live shift expectedCash must equal openingFloat 5000 - (400 OPEX + 250 AP settle + 150 Tax) = 4200.00",
    );

    // Reverse 1010 OPEX payout (₱400) while shift is open -> expectedCash restores accurately (4200 -> 4600)
    const revDrawerOpexRes = await server.requestJson(
      `/api/finances/journal-entries/${Number(drawerOpexRes.data.entryId)}/reverse`,
      {
        method: "POST",
        token: adminUser.token,
        body: { reason: "Reverse shift 1010 OPEX payout while shift open" },
      },
    );
    assert.equal(revDrawerOpexRes.status, 201);
    createdJournalEntryIds.add(Number(revDrawerOpexRes.data.reversalEntryId));

    const currentShiftAfterRevRes = await server.requestJson("/api/sessions/current", { token: adminUser.token });
    assert.equal(currentShiftAfterRevRes.status, 200);
    assert.equal(
      round2(currentShiftAfterRevRes.data.session?.expectedCash),
      4600.0,
      "Reversing ₱400 1010 OPEX payout while shift open must restore expectedCash to 4600.00",
    );

    const closeShiftRes = await server.requestJson(`/api/sessions/${shiftId}/close`, {
      method: "POST",
      token: adminUser.token,
      body: { countedCash: 4600.0, closingNotes: "Exact drawer count after 1010 payouts + reversal" },
    });
    assert.equal(closeShiftRes.status, 200, `Close shift failed: ${closeShiftRes.text}`);
    assert.equal(round2(closeShiftRes.data.session.expectedCash), 4600.0);
    assert.equal(round2(closeShiftRes.data.session.variance), 0.0, "Matching drawer count must produce variance === 0.00");

    // Reversing cash 1510 equipment purchase offsets investingCashFlow back to baseline (0 net investing delta)
    const revEquipRes = await server.requestJson(
      `/api/finances/journal-entries/${Number(equipCashRes.data.entryId)}/reverse`,
      {
        method: "POST",
        token: adminUser.token,
        body: { reason: "Reverse cash equipment purchase for investing Cash Flow parity" },
      },
    );
    assert.equal(revEquipRes.status, 201);
    createdJournalEntryIds.add(Number(revEquipRes.data.reversalEntryId));

    // 5. Final Conservation of Cash parity: cf.netCashFlow === SUM(debit - credit) on 1010..1040
    const cfFinal = (
      await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token: adminUser.token })
    ).data;
    assert.equal(
      round2(cfFinal.investingActivities.netInvestingCashFlow - cfBefore.investingActivities.netInvestingCashFlow),
      0.0,
      "Reversing cash 1510 equipment purchase must offset investingCashFlow back to baseline (0)",
    );
    const actualLiquidDelta = await getLiquidNetSumForDate(today);
    assert.equal(
      round2(cfFinal.netCashFlow),
      actualLiquidDelta,
      `cf.netCashFlow (${cfFinal.netCashFlow}) must equal actual 1010..1040 net liquid delta (${actualLiquidDelta})`,
    );
  });

  // --------------------------------------------------------------------------
  // P2-7: SECURITY HARDENING (INPUT TYPES, SELF-OFFSETS, IDEMPOTENCY KEY, 255-CHAR MEMO)
  // --------------------------------------------------------------------------
  it("P2-7 (Security Hardening): rejects NaN/boolean/mixed-line/self-offset/sub-cent drift, honors clientRequestId idempotency, and handles 250-char reversal reason without 500", async () => {
    const invalidPayloads = [
      {
        label: "string NaN amount",
        body: { entryType: "operating_expense", amount: "NaN", debitAccountCode: "6120", creditAccountCode: "1010", memo: "NaN amount" },
      },
      {
        label: "boolean true amount",
        body: { entryType: "operating_expense", amount: true, debitAccountCode: "6120", creditAccountCode: "1010", memo: "Boolean amount" },
      },
      {
        label: "mixed debit > 0 && credit > 0 on single line",
        body: {
          entryType: "operating_expense",
          memo: "Mixed single line",
          lines: [
            { accountCode: "6120", debit: 100, credit: 50 },
            { accountCode: "1010", debit: 0, credit: 50 },
          ],
        },
      },
      {
        label: "same-account self-offset across lines",
        body: {
          entryType: "adjustment",
          memo: "Same account self-offset",
          lines: [
            { accountCode: "1010", debit: 100, credit: 0 },
            { accountCode: "1010", debit: 0, credit: 100 },
          ],
        },
      },
      {
        label: "sub-cent 10.004 drift",
        body: { entryType: "operating_expense", amount: 10.004, debitAccountCode: "6120", creditAccountCode: "1010", memo: "Sub-cent drift" },
      },
      {
        label: "null lines array elements [null, null]",
        body: { entryType: "operating_expense", memo: "Null lines test", lines: [null, null] },
      },
      {
        label: "oversized 1e20 amount",
        body: { entryType: "operating_expense", amount: 1e20, debitAccountCode: "6120", creditAccountCode: "1010", memo: "Oversized amount" },
      },
    ];

    for (const testCase of invalidPayloads) {
      const badRes = await server.requestJson("/api/finances/journal-entries", {
        method: "POST",
        token: adminUser.token,
        body: testCase.body,
      });
      assert.equal(
        badRes.status,
        400,
        `POST /journal-entries (${testCase.label}) must reject with HTTP 400, got ${badRes.status}: ${badRes.text}`,
      );
    }

    const badOpenBool = await server.requestJson("/api/finances/opening-balance", {
      method: "POST",
      token: adminUser.token,
      body: { cashDrawer: true, notes: "Boolean opening balance" },
    });
    assert.equal(badOpenBool.status, 400, `Opening balance boolean must reject with HTTP 400, got ${badOpenBool.status}`);

    // countedCash: true on POST /sessions/:id/close -> 400
    const badSessOpenRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staffUser.token,
      body: { openingFloat: 0.0, terminalLabel: "Tala P2-7 CountedCash Bool" },
    });
    assert.equal(badSessOpenRes.status, 201);
    const badSessId = Number(badSessOpenRes.data.session.id);
    tracker.sessionIds.add(badSessId);

    const badCountedBoolRes = await server.requestJson(`/api/sessions/${badSessId}/close`, {
      method: "POST",
      token: staffUser.token,
      body: { countedCash: true, closingNotes: "Boolean countedCash test" },
    });
    assert.equal(
      badCountedBoolRes.status,
      400,
      `countedCash: true on session close must reject with HTTP 400, got ${badCountedBoolRes.status}: ${badCountedBoolRes.text}`,
    );
    const cleanCloseRes = await server.requestJson(`/api/sessions/${badSessId}/close`, {
      method: "POST",
      token: staffUser.token,
      body: { countedCash: 0.0, closingNotes: "Clean close after bool rejection" },
    });
    assert.equal(cleanCloseRes.status, 200);

    // Inactive COA (is_active = FALSE) rejects POST /journal-entries with 400 (restored in try/finally)
    await pool.execute("UPDATE chart_of_accounts SET is_active = FALSE WHERE account_code = '6179'");
    try {
      const inactiveCoaRes = await server.requestJson("/api/finances/journal-entries", {
        method: "POST",
        token: adminUser.token,
        body: {
          entryType: "operating_expense",
          amount: 50.0,
          debitAccountCode: "6179",
          creditAccountCode: "1010",
          memo: "Inactive COA rejection check",
        },
      });
      assert.equal(
        inactiveCoaRes.status,
        400,
        `Inactive COA account (is_active = FALSE) must reject with HTTP 400, got ${inactiveCoaRes.status}: ${inactiveCoaRes.text}`,
      );
    } finally {
      await pool.execute("UPDATE chart_of_accounts SET is_active = TRUE WHERE account_code = '6179'");
    }

    // F-05: 12x Concurrent POST /journal-entries (exceeding connectionLimit: 10) with identical clientRequestId returns single entryId (0 pool deadlock, 0 HTTP 500, and 409 on mismatched payload)
    const idemKey = randomUUID();
    const validBody = {
      entryType: "operating_expense",
      amount: 120.0,
      debitAccountCode: "6171",
      creditAccountCode: "1010",
      memo: "Idempotent office expense P2-7 F-05 12x",
      clientRequestId: idemKey,
    };

    const concJeResponses = await Promise.all(
      Array.from({ length: 12 }, () =>
        server.requestJson("/api/finances/journal-entries", {
          method: "POST",
          token: adminUser.token,
          body: validBody,
        }),
      ),
    );
    assert.equal(concJeResponses.length, 12);
    for (const r of concJeResponses) {
      assert.ok(
        [200, 201].includes(r.status),
        `F-05 12x concurrent idempotent JE replay failed (0 HTTP 500 / 0 pool deadlock expected): ${r.status}: ${r.text}`,
      );
    }
    const concJeIds = new Set(concJeResponses.map((r) => Number(r.data.entryId)));
    assert.equal(concJeIds.size, 1, "F-05 12x concurrent duplicate clientRequestId must resolve to single entryId");
    const entryId1 = [...concJeIds][0];
    createdJournalEntryIds.add(entryId1);

    const mismatchJeRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: { ...validBody, amount: 130.0 },
    });
    assert.equal(
      mismatchJeRes.status,
      409,
      `Reusing JE clientRequestId with mismatched payload must reject 409, got ${mismatchJeRes.status}: ${mismatchJeRes.text}`,
    );

    const [[idemCountRow]] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM journal_entries WHERE idempotency_key = ?",
      [idemKey],
    );
    assert.equal(Number(idemCountRow.cnt), 1, "Duplicate clientRequestId must insert exactly 1 journal_entries row");

    // 300-char (>255) reversal reasons on both GL reversal & internal-use reversal must slice cleanly to 255 chars without 500 ER_DATA_TOO_LONG
    const longReason = "R".repeat(300);
    const longRevRes = await server.requestJson(`/api/finances/journal-entries/${entryId1}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: longReason },
    });
    assert.equal(
      longRevRes.status,
      201,
      `300-char GL reversal reason must succeed cleanly with 201 (no 500 truncation failure), got ${longRevRes.status}: ${longRevRes.text}`,
    );
    const revId = Number(longRevRes.data.reversalEntryId);
    createdJournalEntryIds.add(revId);

    const [[revMemoRow]] = await pool.execute(
      "SELECT memo, CHAR_LENGTH(memo) AS memo_len FROM journal_entries WHERE id = ? LIMIT 1",
      [revId],
    );
    assert.equal(Number(revMemoRow.memo_len), 255, "GL reversal memo > 255 chars must be truncated to exact 255 chars in DB");
    assert.ok(String(revMemoRow.memo || "").startsWith("Reversal of "));

    const memoTestItem = await createTestInventoryItem({
      namePrefix: "TalaP2MemoClamp",
      quantity: 5,
      unit: "pcs",
      purchasePrice: 100,
      packageQuantity: 5,
      packageUnit: "pcs",
      contentsPerPackage: 1,
    });
    const memoUseRes = await server.requestJson(`/api/inventory/${memoTestItem.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: {
        quantity: 1,
        expenseAccountCode: "6113",
        note: "Internal-use for >255-char reversal memo test",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(memoUseRes.status, 201);
    const memoUseMoveId = Number(memoUseRes.data.movementId ?? memoUseRes.data.id);
    createdJournalEntryIds.add(Number(memoUseRes.data.journalEntryId));

    const longInvRevRes = await server.requestJson(`/api/inventory/internal-use/${memoUseMoveId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "I".repeat(300) },
    });
    assert.equal(
      longInvRevRes.status,
      200,
      `300-char internal-use reversal reason must succeed cleanly with 200, got ${longInvRevRes.status}: ${longInvRevRes.text}`,
    );
    const invRevJeId = Number(longInvRevRes.data.journalEntryId);
    createdJournalEntryIds.add(invRevJeId);

    const [[invRevMemoRow]] = await pool.execute(
      "SELECT memo, CHAR_LENGTH(memo) AS memo_len FROM journal_entries WHERE id = ? LIMIT 1",
      [invRevJeId],
    );
    assert.equal(Number(invRevMemoRow.memo_len), 255, "Internal-use reversal JE memo > 255 chars must be truncated to exact 255 chars in DB");
    assert.ok(String(invRevMemoRow.memo || "").startsWith("Reversal of internal-use movement"));
  });

  // --------------------------------------------------------------------------
  // P2-8: STATIC UI / CSS CONTRACT VERIFICATION
  // --------------------------------------------------------------------------
  it("P2-8 (Static UI/CSS Contract): verifies Change Image contrast override CSS, Pixel CSS accessibility rules, P&L waterfall + FinDialog in FinancialReconciliationCenter.jsx, and CSPRNG in AdminInventory.jsx", async () => {
    const cssPath = path.resolve("src/assets/css/admin/AdminMenuManagement.css");
    const finCssPath = path.resolve("src/assets/css/admin/FinancialManagement.css");
    const invCssPath = path.resolve("src/assets/css/admin/AdminInventory.css");
    const finPath = path.resolve("src/components/FinancialReconciliationCenter.jsx");
    const invPath = path.resolve("src/pages/admin/AdminInventory.jsx");

    const [menuCss, finCss, invCss, finJsx, invJsx] = await Promise.all([
      fs.readFile(cssPath, "utf-8"),
      fs.readFile(finCssPath, "utf-8"),
      fs.readFile(invCssPath, "utf-8"),
      fs.readFile(finPath, "utf-8"),
      fs.readFile(invPath, "utf-8"),
    ]);

    // 1. AdminMenuManagement.css contrast override for Change Image button (light & dark mode)
    const lightRuleMatch = menuCss.match(
      /\.admin-menu-modal\.menu-builder\s+\.menu-builder-change-btn\s*\{([^}]*)\}/,
    );
    assert.ok(
      lightRuleMatch &&
        /background(?:-color)?:\s*#603b26/i.test(lightRuleMatch[1]) &&
        /color:\s*#fff(?:fff)?/i.test(lightRuleMatch[1]),
      "AdminMenuManagement.css must define .admin-menu-modal.menu-builder .menu-builder-change-btn with #ffffff on #603b26",
    );
    assert.ok(
      /\.admin-menu-page\.dark-mode\s+\.admin-menu-modal\.menu-builder\s+\.menu-builder-change-btn\s*\{/.test(menuCss),
      "AdminMenuManagement.css must define dark-mode .menu-builder-change-btn specificity override",
    );

    // 1b. Pixel CSS accessibility & contrast guards in FinancialManagement.css and AdminInventory.css
    assert.ok(
      finCss.includes(".fin-preset-chip.is-active:hover:not(:disabled)"),
      "FinancialManagement.css must contain .fin-preset-chip.is-active:hover:not(:disabled)",
    );
    assert.ok(
      invCss.includes(".inventory-restock-field select:focus-visible"),
      "AdminInventory.css must contain .inventory-restock-field select:focus-visible",
    );

    // 2. FinancialReconciliationCenter.jsx: FinDialog + Net Income Before Tax + NET INCOME waterfall + 8 OPEX groups
    assert.ok(
      /function\s+FinDialog\b|const\s+FinDialog\s*=/.test(finJsx),
      "FinancialReconciliationCenter.jsx must define FinDialog accessible shell",
    );
    assert.ok(/Net Income Before Tax/i.test(finJsx), "FinancialReconciliationCenter.jsx must render Net Income Before Tax row");
    assert.ok(/NET INCOME/.test(finJsx), "FinancialReconciliationCenter.jsx must render NET INCOME waterfall hero");
    assert.ok(/Labor & Payroll/.test(finJsx), "FinancialReconciliationCenter.jsx OPEX_GROUP_ORDER must include Labor & Payroll");
    assert.ok(/Advertising & Marketing/.test(finJsx), "FinancialReconciliationCenter.jsx OPEX_GROUP_ORDER must include Advertising & Marketing");
    assert.ok(/Repairs & Maintenance/.test(finJsx), "FinancialReconciliationCenter.jsx OPEX_GROUP_ORDER must include Repairs & Maintenance");

    // 3. AdminInventory.jsx: crypto.getRandomValues (zero Math.random in createInternalUseRequestId) + 6113 Staff Meals
    const requestIdBlockMatch = invJsx.match(/const\s+createInternalUseRequestId\s*=\s*useCallback\([\s\S]*?\},\s*\[\]\);/);
    assert.ok(requestIdBlockMatch, "AdminInventory.jsx must define createInternalUseRequestId");
    const requestIdBlock = requestIdBlockMatch[0];
    assert.ok(
      /crypto\.getRandomValues/.test(requestIdBlock),
      "createInternalUseRequestId must use crypto.getRandomValues fallback",
    );
    assert.equal(
      /Math\.random/.test(requestIdBlock),
      false,
      "createInternalUseRequestId must NEVER use Math.random()",
    );
    assert.ok(/6113/.test(invJsx), "AdminInventory.jsx Store Use modal must include 6113 Staff Meals");
  });
});
