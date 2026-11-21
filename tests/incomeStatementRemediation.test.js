import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

describe("Tala TDD Suite: Phase 1 Income Statement Remediation (13 Partial & Misplaced Items)", () => {
  let server;
  let adminUser;
  let staffUser;
  let today;
  const tracker = createCleanupTracker();
  const createdJournalEntryIds = new Set();
  const createdSnapshotDates = new Set();
  const createdItemNames = new Set();
  const createdActorNames = new Set();

  async function createTestInventoryItem({
    namePrefix = "TalaRemInv",
    category = "Primary ingredient",
    quantity = 1000,
    unit = "g",
    purchasePrice = 100,
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
    namePrefix = "TalaRemMenu",
    basePrice = 100,
    inventoryItem,
    quantityUsed = 100,
    unit = "g",
  }) {
    const tag = makeUniqueTag("MenuCat");
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

    server = await startTestServer({ unlockNetIncome: true });
    adminUser = await tracker.createUser({
      role: "admin",
      displayName: makeUniqueTag("Tala Rem Admin"),
      username: makeUniqueTag("tala_rem_admin").toLowerCase(),
    });
    staffUser = await tracker.createUser({
      role: "staff",
      displayName: makeUniqueTag("Tala Rem Staff"),
      username: makeUniqueTag("tala_rem_staff").toLowerCase(),
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
        for (const r of foundOrders) tracker.orderIds.add(Number(r.id));
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

      const jeConds = [];
      const jeParams = [];
      if (createdJournalEntryIds.size > 0) {
        const ids = [...createdJournalEntryIds];
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
        const jeIds = [...new Set(jeRows.map((r) => Number(r.id)))];
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
  // TEST 1: 6030 COGS RECLASSIFICATION & NO PREFIX BLINDNESS
  // --------------------------------------------------------------------------
  it("TEST 1 (6030 COGS Reclassification): posting waste debits 6030, surfaces foodSpoilageCogs in COGS, lowers grossProfit, and keeps totalOperatingExpenses === 0", async () => {
    const oil = await createTestInventoryItem({
      namePrefix: "TalaSpoilOil",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000, // ₱0.10/g
    });
    const product = await createTestMenuProduct({
      namePrefix: "TalaFries",
      basePrice: 100,
      inventoryItem: oil,
      quantityUsed: 100, // ₱10.00 COGS per order
      unit: "g",
    });

    const orderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: adminUser.token,
      body: {
        customerName: "Tala Spoilage Baseline Customer",
        type: "Takeout",
        paymentMethod: "Cash",
        items: [{ productId: product.id, quantity: 1, size: "Regular" }],
      },
    });
    assert.equal(orderRes.status, 201, `Order setup failed: ${orderRes.text}`);
    tracker.orderIds.add(Number(orderRes.data.id));

    const pnlBeforeRes = await server.requestJson(
      `/api/finances/reports/profit-and-loss?from=${today}&to=${today}`,
      { token: adminUser.token },
    );
    assert.equal(pnlBeforeRes.status, 200);
    const pnlBefore = pnlBeforeRes.data;

    // Post 250g waste -> 250 * ₱0.10 = ₱25.00 DR 6030 / CR 1050
    const wasteRes = await server.requestJson(`/api/inventory/${oil.id}/waste`, {
      method: "POST",
      token: adminUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 250,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Tala Phase 1 6030 COGS test",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(wasteRes.status, 201, `Waste post failed: ${wasteRes.text}`);
    const wasteMovementId = Number(wasteRes.data.id ?? wasteRes.data.movementId);

    const [jeLines] = await pool.execute(
      `SELECT coa.account_code, jel.debit, jel.credit
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.inventory_movement_id = ?`,
      [wasteMovementId],
    );
    const dr6030 = jeLines.find((l) => l.account_code === "6030");
    assert.ok(dr6030 && round2(dr6030.debit) === 25.0, "Waste posting must debit 6030 for ₱25.00");

    const pnlAfterRes = await server.requestJson(
      `/api/finances/reports/profit-and-loss?from=${today}&to=${today}`,
      { token: adminUser.token },
    );
    assert.equal(pnlAfterRes.status, 200);
    const pnlAfter = pnlAfterRes.data;

    assert.equal(typeof pnlAfter.foodSpoilageCogs, "number", "P&L must return numeric foodSpoilageCogs");
    assert.equal(typeof pnlAfter.customerSalesCogs, "number", "P&L must return numeric customerSalesCogs");
    assert.ok(pnlAfter.foodSpoilageCogs > 0, `foodSpoilageCogs must be > 0, got ${pnlAfter.foodSpoilageCogs}`);
    assert.equal(round2(pnlAfter.foodSpoilageCogs), 25.0, "foodSpoilageCogs must equal ₱25.00");
    assert.equal(
      round2(pnlAfter.customerSalesCogs + pnlAfter.foodSpoilageCogs),
      round2(pnlAfter.cogs),
      "customerSalesCogs + foodSpoilageCogs must equal total cogs",
    );
    assert.equal(
      round2(pnlBefore.grossProfit - pnlAfter.grossProfit),
      25.0,
      "6030 spoilage must reduce grossProfit by exactly ₱25.00",
    );
    assert.equal(
      round2(pnlAfter.totalOperatingExpenses),
      0,
      "6030 spoilage must NEVER inflate totalOperatingExpenses",
    );
    assert.equal(
      (pnlAfter.operatingExpenses || []).some((row) => row.accountCode === "6030"),
      false,
      "operatingExpenses array must NEVER contain 6030",
    );
  });

  // --------------------------------------------------------------------------
  // TEST 2: SEPARATED OPEX ACCOUNTS, EXPENSE GROUPS & BALANCE SHEET EQUILIBRIUM
  // --------------------------------------------------------------------------
  it("TEST 2 (Separated OPEX Accounts & Expense Groups): exposes reportSection/expenseGroup, groups 6120/6130/6144/6172 in P&L, matches ebitdaOperatingIncome, and balances Balance Sheet", async () => {
    const accountsRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(accountsRes.status, 200);
    const accountsByCode = new Map(accountsRes.data.accounts.map((a) => [a.accountCode, a]));

    const expectedMeta = [
      // Migration 051 (USAR): rent is non-controllable occupancy; 6040 is G&A cash over/short.
      ["6120", "occupancy", "Occupancy"],
      ["6130", "opex", "Utilities"],
      ["6140", "opex", "Operating Supplies"],
      ["6144", "opex", "Operating Supplies"],
      ["6172", "opex", "General & Administrative (G&A)"],
      ["6030", "cogs", null],
      ["6010", "opex", "Others"],
      ["6040", "opex", "General & Administrative (G&A)"],
    ];

    for (const [code, expectedSection, expectedGroup] of expectedMeta) {
      const acc = accountsByCode.get(code);
      assert.ok(acc, `Account ${code} must exist in GET /api/finances/accounts`);
      assert.equal(
        acc.reportSection,
        expectedSection,
        `Account ${code} reportSection must be '${expectedSection}', got '${acc.reportSection}'`,
      );
      if (expectedGroup !== null) {
        assert.equal(
          acc.expenseGroup,
          expectedGroup,
          `Account ${code} expenseGroup must be '${expectedGroup}', got '${acc.expenseGroup}'`,
        );
      }
    }

    const pnlBeforeRes = await server.requestJson(
      `/api/finances/reports/profit-and-loss?from=${today}&to=${today}`,
      { token: adminUser.token },
    );
    assert.equal(pnlBeforeRes.status, 200);
    const pnlBefore = pnlBeforeRes.data;

    const postings = [
      { code: "6120", amount: 500.0, group: "Occupancy", memo: "Tala monthly rent" },
      { code: "6130", amount: 200.0, group: "Utilities", memo: "Tala electricity bill" },
      { code: "6144", amount: 150.0, group: "Operating Supplies", memo: "Tala sanitizer stock" },
      { code: "6172", amount: 100.0, group: "General & Administrative (G&A)", memo: "Tala mayor permit" },
    ];
    for (const item of postings) {
      const res = await server.requestJson("/api/finances/journal-entries", {
        method: "POST",
        token: adminUser.token,
        body: {
          entryType: "operating_expense",
          amount: item.amount,
          debitAccountCode: item.code,
          creditAccountCode: "1010",
          memo: item.memo,
        },
      });
      assert.equal(res.status, 201, `Posting OPEX ${item.code} failed: ${res.text}`);
      createdJournalEntryIds.add(Number(res.data.entryId));
    }

    const pnlAfterRes = await server.requestJson(
      `/api/finances/reports/profit-and-loss?from=${today}&to=${today}`,
      { token: adminUser.token },
    );
    assert.equal(pnlAfterRes.status, 200);
    const pnlAfter = pnlAfterRes.data;

    const opexByCode = new Map((pnlAfter.operatingExpenses || []).map((row) => [row.accountCode, row]));
    for (const item of postings) {
      const row = opexByCode.get(item.code);
      assert.ok(row, `P&L operatingExpenses must include ${item.code}`);
      assert.equal(row.expenseGroup, item.group, `P&L ${item.code} expenseGroup must be '${item.group}'`);
      assert.equal(round2(row.amount), item.amount, `P&L ${item.code} amount must be ₱${item.amount.toFixed(2)}`);
    }

    assert.equal(
      round2(pnlAfter.totalOperatingExpenses - pnlBefore.totalOperatingExpenses),
      950.0,
      "totalOperatingExpenses must increase by ₱950.00 across 6120+6130+6144+6172",
    );
    assert.equal(typeof pnlAfter.ebitdaOperatingIncome, "number", "P&L must expose ebitdaOperatingIncome");
    assert.equal(
      round2(pnlAfter.ebitdaOperatingIncome),
      round2(pnlAfter.netOperatingProfit),
      "ebitdaOperatingIncome must equal netOperatingProfit",
    );
    assert.strictEqual(pnlAfter.depreciation, 0, "P&L must expose numeric depreciation: 0");
    assert.strictEqual(pnlAfter.tax, 0, "P&L must expose numeric tax: 0");

    const bsRes = await server.requestJson("/api/finances/reports/balance-sheet", {
      token: adminUser.token,
    });
    assert.equal(bsRes.status, 200);
    assert.equal(bsRes.data.isBalanced, true, "Balance Sheet must stay balanced after 61xx OPEX postings");
    assert.equal(round2(bsRes.data.balanceDifference), 0, "Balance Sheet difference must equal 0");
  });

  // --------------------------------------------------------------------------
  // TEST 3: SHIFT-CLOSE 6040 CASH DRAWER DISCREPANCY AUTO-POSTING
  // --------------------------------------------------------------------------
  it("TEST 3 (Shift-Close 6040 Discrepancy): auto-posts DR 6040/CR 1010 on shortage (and DR 1010/CR 6040 on overage) idempotently without contaminating daily reconciliation OPEX with 6030", async () => {
    // Ensure 6030 spoilage exists on today's ledger even if Test 3 runs standalone
    const spoilItem = await createTestInventoryItem({
      namePrefix: "TalaShiftSpoil",
      quantity: 500,
      unit: "g",
      purchasePrice: 50,
      packageQuantity: 1,
      packageUnit: "pack",
      contentsPerPackage: 500, // ₱0.10/g
    });
    const wasteRes = await server.requestJson(`/api/inventory/${spoilItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 150, // ₱15.00
        measuredUnit: "g",
        wasteReason: "expired_spoiled",
        note: "Tala Test 3 spoilage check",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(wasteRes.status, 201, `Setup waste failed: ${wasteRes.text}`);

    const pnlBeforeRes = await server.requestJson(
      `/api/finances/reports/profit-and-loss?from=${today}&to=${today}`,
      { token: adminUser.token },
    );
    assert.equal(pnlBeforeRes.status, 200);
    const opexBefore = round2(pnlBeforeRes.data.totalOperatingExpenses);

    // 1. Shortage case: open float 1000, close counted 950 -> -50 variance
    const openShortRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staffUser.token,
      body: { openingFloat: 1000.0, terminalLabel: "Tala Shortage Reg" },
    });
    assert.equal(openShortRes.status, 201, `Open session A failed: ${openShortRes.text}`);
    const shortSessionId = Number(openShortRes.data.session.id);
    tracker.sessionIds.add(shortSessionId);

    const closeShortRes = await server.requestJson(`/api/sessions/${shortSessionId}/close`, {
      method: "POST",
      token: staffUser.token,
      body: { countedCash: 950.0, closingNotes: "Shortage test" },
    });
    assert.equal(closeShortRes.status, 200, `Close session A failed: ${closeShortRes.text}`);
    assert.equal(round2(closeShortRes.data.session.variance), -50.0);

    const [shortJeRows] = await pool.execute(
      `SELECT id, idempotency_key
         FROM journal_entries
        WHERE session_id = ?
          AND idempotency_key = ?`,
      [shortSessionId, `session:${shortSessionId}:cash_variance`],
    );
    assert.equal(shortJeRows.length, 1, "Shortage shift close must auto-post exactly 1 variance journal entry with idempotency_key");
    const shortJeId = Number(shortJeRows[0].id);
    createdJournalEntryIds.add(shortJeId);

    const [shortLines] = await pool.execute(
      `SELECT coa.account_code, jel.debit, jel.credit
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id = ?`,
      [shortJeId],
    );
    const short6040 = shortLines.find((l) => l.account_code === "6040");
    const short1010 = shortLines.find((l) => l.account_code === "1010");
    assert.ok(short6040 && round2(short6040.debit) === 50.0 && round2(short6040.credit) === 0, "Shortage must DR 6040 ₱50.00");
    assert.ok(short1010 && round2(short1010.credit) === 50.0 && round2(short1010.debit) === 0, "Shortage must CR 1010 ₱50.00");

    // Retry close must not duplicate variance entry
    const retryCloseRes = await server.requestJson(`/api/sessions/${shortSessionId}/close`, {
      method: "POST",
      token: staffUser.token,
      body: { countedCash: 950.0, closingNotes: "Retry close" },
    });
    assert.equal(retryCloseRes.status, 409);
    const [[shortJeCount]] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM journal_entries WHERE session_id = ? AND idempotency_key = ?",
      [shortSessionId, `session:${shortSessionId}:cash_variance`],
    );
    assert.equal(Number(shortJeCount.cnt), 1, "Variance posting must remain idempotent across retries");

    // Check P&L reflects 6040 under Others & daily reconciliation OPEX excludes 6030 spoilage
    const pnlAfterShortRes = await server.requestJson(
      `/api/finances/reports/profit-and-loss?from=${today}&to=${today}`,
      { token: adminUser.token },
    );
    assert.equal(pnlAfterShortRes.status, 200);
    const pnlAfterShort = pnlAfterShortRes.data;
    const row6040 = (pnlAfterShort.operatingExpenses || []).find((r) => r.accountCode === "6040");
    assert.ok(row6040, "P&L operatingExpenses must include 6040 after cash shortage");
    assert.equal(row6040.expenseGroup, "General & Administrative (G&A)", "6040 (Cash Over/Short) expenseGroup must be G&A");
    assert.equal(round2(row6040.amount), 50.0);
    assert.equal(
      round2(pnlAfterShort.totalOperatingExpenses - opexBefore),
      50.0,
      "P&L totalOperatingExpenses delta must equal ₱50.00 shortage only (zero 6030 contamination)",
    );

    const reconRes = await server.requestJson(
      `/api/finances/reports/daily-reconciliation?from=${today}&to=${today}`,
      { token: adminUser.token },
    );
    assert.equal(reconRes.status, 200);
    const todaySnap = (reconRes.data.items || []).find((item) => String(item.businessDate).startsWith(today));
    assert.ok(todaySnap, "Daily reconciliation must contain today's snapshot");
    assert.ok(todaySnap.spoilageShrinkage >= 15.0, "Daily reconciliation spoilageShrinkage must record 6030 spoilage");
    assert.equal(
      round2(todaySnap.operatingExpenses),
      round2(pnlAfterShort.totalOperatingExpenses),
      "Daily reconciliation operatingExpenses must equal clean OPEX and NOT add 6030 spoilage",
    );

    // 2. Overage case: open float 500, close counted 520 -> +20 variance (DR 1010 / CR 6040)
    const openOverRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staffUser.token,
      body: { openingFloat: 500.0, terminalLabel: "Tala Overage Reg" },
    });
    assert.equal(openOverRes.status, 201, `Open session B failed: ${openOverRes.text}`);
    const overSessionId = Number(openOverRes.data.session.id);
    tracker.sessionIds.add(overSessionId);

    const closeOverRes = await server.requestJson(`/api/sessions/${overSessionId}/close`, {
      method: "POST",
      token: staffUser.token,
      body: { countedCash: 520.0, closingNotes: "Overage test" },
    });
    assert.equal(closeOverRes.status, 200, `Close session B failed: ${closeOverRes.text}`);
    assert.equal(round2(closeOverRes.data.session.variance), 20.0);

    const [overJeRows] = await pool.execute(
      `SELECT id
         FROM journal_entries
        WHERE session_id = ?
          AND idempotency_key = ?`,
      [overSessionId, `session:${overSessionId}:cash_variance`],
    );
    assert.equal(overJeRows.length, 1, "Overage shift close must auto-post variance journal entry");
    const overJeId = Number(overJeRows[0].id);
    createdJournalEntryIds.add(overJeId);

    const [overLines] = await pool.execute(
      `SELECT coa.account_code, jel.debit, jel.credit
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id = ?`,
      [overJeId],
    );
    const over1010 = overLines.find((l) => l.account_code === "1010");
    const over6040 = overLines.find((l) => l.account_code === "6040");
    assert.ok(over1010 && round2(over1010.debit) === 20.0 && round2(over1010.credit) === 0, "Overage must DR 1010 ₱20.00");
    assert.ok(over6040 && round2(over6040.credit) === 20.0 && round2(over6040.debit) === 0, "Overage must CR 6040 ₱20.00");

    // 3. Exact zero variance case: open float 750, close counted 750 -> variance 0, zero 6040 entry
    const openZeroRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staffUser.token,
      body: { openingFloat: 750.0, terminalLabel: "Tala Zero Variance Reg" },
    });
    assert.equal(openZeroRes.status, 201, `Open session C failed: ${openZeroRes.text}`);
    const zeroSessionId = Number(openZeroRes.data.session.id);
    tracker.sessionIds.add(zeroSessionId);

    const closeZeroRes = await server.requestJson(`/api/sessions/${zeroSessionId}/close`, {
      method: "POST",
      token: staffUser.token,
      body: { countedCash: 750.0, closingNotes: "Exact zero variance test" },
    });
    assert.equal(closeZeroRes.status, 200, `Close session C failed: ${closeZeroRes.text}`);
    assert.equal(round2(closeZeroRes.data.session.variance), 0);

    const [[zeroJeCount]] = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM journal_entries WHERE session_id = ?",
      [zeroSessionId],
    );
    assert.equal(Number(zeroJeCount.cnt), 0, "Exact variance === 0 must post zero 6040 variance journal entries");
  });

  // --------------------------------------------------------------------------
  // TEST 4: INVENTORY INTERNAL STORE USE (POST /api/inventory/:id/internal-use)
  // --------------------------------------------------------------------------
  it("TEST 4 (Inventory Internal Store Use): deducts stock, logs internal_use movement, posts DR 6144/6130 CR 1050 (never 6030), rejects invalid codes (400) & enforces admin RBAC (403)", async () => {
    const cleaner = await createTestInventoryItem({
      namePrefix: "TalaSanitizer",
      category: "Primary ingredient",
      quantity: 10,
      unit: "bottles",
      purchasePrice: 500,
      packageQuantity: 10,
      packageUnit: "bottle",
      contentsPerPackage: 1, // ₱50.00/bottle
    });
    const lpg = await createTestInventoryItem({
      namePrefix: "TalaLpgTank",
      category: "Primary ingredient",
      quantity: 2,
      unit: "tanks",
      purchasePrice: 1800,
      packageQuantity: 2,
      packageUnit: "tank",
      contentsPerPackage: 1, // ₱900.00/tank
    });

    // Staff must receive 403 Forbidden
    const staffRes = await server.requestJson(`/api/inventory/${cleaner.id}/internal-use`, {
      method: "POST",
      token: staffUser.token,
      body: { quantity: 1, expenseAccountCode: "6144", note: "Unauthorized staff store use" },
    });
    assert.equal(staffRes.status, 403, `Non-admin internal-use must return 403, got ${staffRes.status}: ${staffRes.text}`);

    // Non-whitelisted codes (6030 spoilage, 4010 revenue) must be rejected with 400
    for (const invalidCode of ["6030", "4010"]) {
      const badCodeRes = await server.requestJson(`/api/inventory/${cleaner.id}/internal-use`, {
        method: "POST",
        token: adminUser.token,
        body: { quantity: 1, expenseAccountCode: invalidCode, note: "Invalid code test" },
      });
      assert.equal(
        badCodeRes.status,
        400,
        `Non-whitelisted account '${invalidCode}' must return HTTP 400, got ${badCodeRes.status}: ${badCodeRes.text}`,
      );
    }

    // Valid sanitation supply internal use (6144)
    const cleanUseRes = await server.requestJson(`/api/inventory/${cleaner.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 2, expenseAccountCode: "6144", note: "Kitchen sanitation refill" },
    });
    assert.ok(
      [200, 201].includes(cleanUseRes.status),
      `Admin internal-use (6144) must succeed with 200/201, got ${cleanUseRes.status}: ${cleanUseRes.text}`,
    );

    const [[cleanerRow]] = await pool.execute(
      "SELECT quantity FROM inventory_items WHERE id = ? LIMIT 1",
      [cleaner.id],
    );
    assert.equal(Number(cleanerRow.quantity), 8, "Cleaning supply quantity must decrease from 10 to 8");

    const [cleanMovements] = await pool.execute(
      `SELECT id, movement_type, quantity_change, batch_cost
         FROM inventory_movements
        WHERE inventory_item_id = ? AND movement_type = 'internal_use'`,
      [cleaner.id],
    );
    assert.equal(cleanMovements.length, 1, "Must record inventory_movements row with movement_type = 'internal_use'");
    assert.equal(Number(cleanMovements[0].quantity_change), -2);
    const cleanMoveId = Number(cleanMovements[0].id);

    const [cleanJeLines] = await pool.execute(
      `SELECT coa.account_code, jel.debit, jel.credit
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.inventory_movement_id = ?`,
      [cleanMoveId],
    );
    assert.ok(
      cleanJeLines.some((l) => l.account_code === "6144" && round2(l.debit) === 100.0),
      "Internal use (6144) must debit 6144 for ₱100.00",
    );
    assert.ok(
      cleanJeLines.some((l) => l.account_code === "1050" && round2(l.credit) === 100.0),
      "Internal use (6144) must credit 1050 for ₱100.00",
    );
    assert.equal(
      cleanJeLines.some((l) => l.account_code === "6030"),
      false,
      "Internal use must NEVER post to 6030 spoilage",
    );

    // Valid LPG utility internal use (6130)
    const lpgUseRes = await server.requestJson(`/api/inventory/${lpg.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 1, expenseAccountCode: "6130", note: "Stove LPG cylinder opened" },
    });
    assert.ok(
      [200, 201].includes(lpgUseRes.status),
      `Admin internal-use (6130) must succeed with 200/201, got ${lpgUseRes.status}: ${lpgUseRes.text}`,
    );

    const [lpgMovements] = await pool.execute(
      "SELECT id FROM inventory_movements WHERE inventory_item_id = ? AND movement_type = 'internal_use'",
      [lpg.id],
    );
    assert.equal(lpgMovements.length, 1);
    const [lpgJeLines] = await pool.execute(
      `SELECT coa.account_code, jel.debit, jel.credit
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.inventory_movement_id = ?`,
      [Number(lpgMovements[0].id)],
    );
    assert.ok(
      lpgJeLines.some((l) => l.account_code === "6130" && round2(l.debit) === 900.0),
      "Internal use (6130) must debit 6130 for ₱900.00",
    );
    assert.ok(
      lpgJeLines.some((l) => l.account_code === "1050" && round2(l.credit) === 900.0),
      "Internal use (6130) must credit 1050 for ₱900.00",
    );

    // Movements filter must accept type=internal_use
    const movFilterRes = await server.requestJson(
      `/api/inventory/movements?type=internal_use&itemId=${cleaner.id}`,
      { token: adminUser.token },
    );
    assert.equal(
      movFilterRes.status,
      200,
      `GET /api/inventory/movements?type=internal_use must return 200, got ${movFilterRes.status}: ${movFilterRes.text}`,
    );
    assert.ok(
      (movFilterRes.data?.items || []).some((m) => Number(m.id) === cleanMoveId && m.type === "internal_use"),
      "Filtered movements must return the internal_use record",
    );

    // Boundary checks: quantity <= 0 -> 400; quantity > stock -> 409
    for (const badQty of [0, -1]) {
      const badQtyRes = await server.requestJson(`/api/inventory/${cleaner.id}/internal-use`, {
        method: "POST",
        token: adminUser.token,
        body: { quantity: badQty, expenseAccountCode: "6144", note: "Non-positive qty test" },
      });
      assert.equal(
        badQtyRes.status,
        400,
        `Non-positive quantity (${badQty}) must return HTTP 400, got ${badQtyRes.status}: ${badQtyRes.text}`,
      );
    }

    const overStockRes = await server.requestJson(`/api/inventory/${cleaner.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 999, expenseAccountCode: "6144", note: "Over-stock test" },
    });
    assert.equal(
      overStockRes.status,
      409,
      `Quantity > stock must return HTTP 409, got ${overStockRes.status}: ${overStockRes.text}`,
    );

    // Zero unit_cost item -> 200/201 with journalEntryId: null and stock still deducted
    const zeroCostSupply = await createTestInventoryItem({
      namePrefix: "TalaZeroCostSupply",
      category: "Primary ingredient",
      quantity: 5,
      unit: "pcs",
      purchasePrice: 0,
      packageQuantity: 1,
      packageUnit: "pack",
      contentsPerPackage: 1,
    });
    const zeroCostRes = await server.requestJson(`/api/inventory/${zeroCostSupply.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 2, expenseAccountCode: "6140", note: "Zero cost internal use" },
    });
    assert.ok(
      [200, 201].includes(zeroCostRes.status),
      `Zero unit_cost internal-use must return 200/201, got ${zeroCostRes.status}: ${zeroCostRes.text}`,
    );
    assert.strictEqual(zeroCostRes.data.journalEntryId, null, "Zero unit_cost internal-use must set journalEntryId: null");
    const [[zeroAfterRow]] = await pool.execute(
      "SELECT quantity FROM inventory_items WHERE id = ? LIMIT 1",
      [zeroCostSupply.id],
    );
    assert.equal(Number(zeroAfterRow.quantity), 3, "Zero unit_cost item stock must still deduct from 5 to 3");

    // clientRequestId idempotency: same payload replays 200 once; different payload -> 409
    const idemKey = randomUUID();
    const idemFirstRes = await server.requestJson(`/api/inventory/${cleaner.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 1, expenseAccountCode: "6144", note: "Idempotent internal use", clientRequestId: idemKey },
    });
    assert.equal(idemFirstRes.status, 201, `Initial idempotent internal-use must return 201, got ${idemFirstRes.status}: ${idemFirstRes.text}`);

    const idemReplayRes = await server.requestJson(`/api/inventory/${cleaner.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 1, expenseAccountCode: "6144", note: "Idempotent internal use", clientRequestId: idemKey },
    });
    assert.equal(idemReplayRes.status, 200, `Replay with identical clientRequestId & payload must return 200, got ${idemReplayRes.status}: ${idemReplayRes.text}`);
    assert.equal(Number(idemReplayRes.data.movementId), Number(idemFirstRes.data.movementId), "Replay must return original movementId");

    const [[cleanerAfterIdem]] = await pool.execute(
      "SELECT quantity FROM inventory_items WHERE id = ? LIMIT 1",
      [cleaner.id],
    );
    assert.equal(Number(cleanerAfterIdem.quantity), 7, "Idempotent replay must deduct stock only once (8 -> 7)");

    const idemConflictRes = await server.requestJson(`/api/inventory/${cleaner.id}/internal-use`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 2, expenseAccountCode: "6144", note: "Idempotent internal use", clientRequestId: idemKey },
    });
    assert.equal(
      idemConflictRes.status,
      409,
      `Replay with same clientRequestId & different payload must return 409, got ${idemConflictRes.status}: ${idemConflictRes.text}`,
    );
  });

  // --------------------------------------------------------------------------
  // TEST 5: SALES SUMMARY EX-VAT & COGS PARITY
  // --------------------------------------------------------------------------
  it("TEST 5 (Sales Summary ex-VAT & COGS Parity): preserves grossCollectedSales while returning grossSales, discountTotal, taxCollected, netSales matching P&L, spoilageCost, and totalCogs", async () => {
    await updateSettings({ vatEnabled: true, vatRatePercent: 12, enforceShiftGate: false });

    const beans = await createTestInventoryItem({
      namePrefix: "TalaVatBeans",
      quantity: 500,
      unit: "g",
      purchasePrice: 200,
      packageQuantity: 1,
      packageUnit: "bag",
      contentsPerPackage: 500, // ₱0.40/g
    });
    const product = await createTestMenuProduct({
      namePrefix: "TalaLatteVat",
      basePrice: 200,
      inventoryItem: beans,
      quantityUsed: 100, // ₱40.00 COGS per cup
      unit: "g",
    });

    const summaryBeforeRes = await server.requestJson("/api/reports/financial-summary?rangeKey=today", {
      token: adminUser.token,
    });
    assert.equal(summaryBeforeRes.status, 200);
    const beforeSummary = summaryBeforeRes.data.summary;

    // Order: subtotal 200.00, discount 20.00 -> netTaxable 180.00, 12% VAT = 21.60, total = 201.60, COGS = 40.00
    const orderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: adminUser.token,
      body: {
        customerName: "Tala VAT Parity Customer",
        type: "Dine-in",
        paymentMethod: "Cash",
        discountAmount: 20.0,
        items: [{ productId: product.id, quantity: 1, size: "Regular" }],
      },
    });
    assert.equal(orderRes.status, 201, `Paid VAT order failed: ${orderRes.text}`);
    tracker.orderIds.add(Number(orderRes.data.id));
    assert.equal(round2(orderRes.data.subtotal), 200.0);
    assert.equal(round2(orderRes.data.discountAmount), 20.0);
    assert.equal(round2(orderRes.data.taxAmount), 21.6);
    assert.equal(round2(orderRes.data.total), 201.6);

    // Waste 50g -> 50 * ₱0.40 = ₱20.00 spoilage
    const wasteRes = await server.requestJson(`/api/inventory/${beans.id}/waste`, {
      method: "POST",
      token: adminUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 50,
        measuredUnit: "g",
        wasteReason: "quality_reject",
        note: "Tala Test 5 spoilage parity",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(wasteRes.status, 201, `Test 5 waste failed: ${wasteRes.text}`);

    const [summaryAfterRes, pnlAfterRes] = await Promise.all([
      server.requestJson("/api/reports/financial-summary?rangeKey=today", { token: adminUser.token }),
      server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: adminUser.token }),
    ]);
    assert.equal(summaryAfterRes.status, 200);
    assert.equal(pnlAfterRes.status, 200);

    const afterSummary = summaryAfterRes.data.summary;
    const pnlAfter = pnlAfterRes.data;

    for (const key of ["grossCollectedSales", "grossSales", "discountTotal", "taxCollected", "netSales", "spoilageCost", "totalCogs", "cogs"]) {
      assert.equal(
        typeof afterSummary[key],
        "number",
        `financial-summary must expose numeric '${key}', got ${typeof afterSummary[key]}`,
      );
    }

    assert.equal(round2(afterSummary.grossCollectedSales - beforeSummary.grossCollectedSales), 201.6);
    assert.equal(round2(afterSummary.grossSales - beforeSummary.grossSales), 200.0);
    assert.equal(round2(afterSummary.discountTotal - beforeSummary.discountTotal), 20.0);
    assert.equal(round2(afterSummary.taxCollected - beforeSummary.taxCollected), 21.6);
    assert.equal(round2(afterSummary.netSales - beforeSummary.netSales), 180.0);
    // Since 87ec98d/044, `cogs` is total COGS including Waste Cost; sold-item COGS is `salesCogs`.
    assert.equal(round2(afterSummary.salesCogs - beforeSummary.salesCogs), 40.0);
    assert.equal(round2(afterSummary.cogs - beforeSummary.cogs), 60.0);
    assert.equal(round2(afterSummary.spoilageCost - beforeSummary.spoilageCost), 20.0);
    assert.equal(round2(afterSummary.totalCogs - beforeSummary.totalCogs), 60.0);

    // Whole-day structural & cross-endpoint parity checks
    assert.equal(
      round2(afterSummary.grossSales - afterSummary.discountTotal),
      round2(afterSummary.netSales),
      "financial-summary netSales must equal grossSales - discountTotal (ex-VAT)",
    );
    assert.equal(
      round2(afterSummary.netSales),
      round2(pnlAfter.netSales),
      "financial-summary netSales must match P&L netSales (ex-VAT)",
    );
    assert.equal(
      round2(afterSummary.salesCogs + afterSummary.spoilageCost),
      round2(afterSummary.totalCogs),
      "financial-summary totalCogs must equal salesCogs + spoilageCost",
    );
    assert.equal(round2(afterSummary.cogs), round2(afterSummary.totalCogs), "cogs is total COGS including Waste Cost");
    assert.equal(
      round2(afterSummary.totalCogs),
      round2(pnlAfter.cogs),
      "financial-summary totalCogs must match P&L cogs",
    );

    // Filtered order slice (paymentMethod=GCash) must NOT include unrelated storewide manual 6030 waste
    const gcashFilteredRes = await server.requestJson(
      "/api/reports/financial-summary?rangeKey=today&paymentMethod=GCash",
      { token: adminUser.token },
    );
    assert.equal(gcashFilteredRes.status, 200, `Filtered GCash summary failed: ${gcashFilteredRes.text}`);
    assert.equal(
      round2(gcashFilteredRes.data.summary.spoilageCost),
      0,
      "Filtered paymentMethod=GCash slice must NOT include storewide manual 6030 spoilage",
    );
  });
});
