import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
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

describe("Tala Suite: Amaya Double-Entry Financial Management & Asset Reconciliation Invariants", () => {
  let server;
  let adminUser;
  let staffUser;
  const tracker = createCleanupTracker();
  const createdJournalEntryIds = new Set();
  const createdSnapshotDates = new Set();

  before(async () => {
    server = await startTestServer();
    adminUser = await tracker.createUser({
      role: "admin",
      displayName: "Tala Financial Admin",
      username: makeUniqueTag("tala_fin_admin").toLowerCase(),
    });
    staffUser = await tracker.createUser({
      role: "staff",
      displayName: "Tala Counter Staff",
      username: makeUniqueTag("tala_fin_staff").toLowerCase(),
    });
  });

  after(async () => {
    try {
      if (createdJournalEntryIds.size > 0) {
        const ids = [...createdJournalEntryIds];
        await pool.execute(
          `DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
        await pool.execute(
          `DELETE FROM journal_entries WHERE id IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      }
      if (createdSnapshotDates.size > 0) {
        const dates = [...createdSnapshotDates];
        await pool.execute(
          `DELETE FROM store_daily_asset_snapshots WHERE business_date IN (${dates.map(() => "?").join(",")})`,
          dates
        );
      }
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  // --------------------------------------------------------------------------
  // INVARIANT 1: DOUBLE-ENTRY PARITY
  // --------------------------------------------------------------------------
  it("INVARIANT 1 (DOUBLE-ENTRY PARITY): requires sum(debits) === sum(credits) and rejects unbalanced entries with HTTP 400", async () => {
    // 1. Rejects multi-line unbalanced journal entry (Debit 500 != Credit 400)
    const unbalancedMultiRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        memo: "Unbalanced split lines test",
        lines: [
          { accountCode: "6010", debit: 500, credit: 0 },
          { accountCode: "1010", debit: 0, credit: 400 },
        ],
      },
    });
    assert.equal(
      unbalancedMultiRes.status,
      400,
      `Unbalanced multi-line entry must be rejected with HTTP 400, got ${unbalancedMultiRes.status}: ${unbalancedMultiRes.text}`
    );
    assert.match(
      unbalancedMultiRes.data?.message || "",
      /balance|parity|debit.*credit/i,
      "Error message must explicitly state that debits and credits do not balance"
    );

    // 2. Rejects unbalanced debit and credit amounts (e.g. amount mismatch)
    const unbalancedAmountRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        debitAccountCode: "6010",
        creditAccountCode: "1010",
        debitAmount: 1500,
        creditAmount: 1200,
        memo: "Unbalanced debit credit amount test",
      },
    });
    assert.equal(
      unbalancedAmountRes.status,
      400,
      `Unbalanced debit/credit amounts must return HTTP 400, got ${unbalancedAmountRes.status}`
    );

    // 3. Rejects identical debit and credit account codes (no self-offset)
    const identicalAccountRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        amount: 250,
        debitAccountCode: "1010",
        creditAccountCode: "1010",
        memo: "Self-offsetting transaction test",
      },
    });
    assert.equal(
      identicalAccountRes.status,
      400,
      `Same debit and credit account must return HTTP 400, got ${identicalAccountRes.status}`
    );

    // 4. Rejects zero or negative amount
    const nonPositiveRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        amount: -50,
        debitAccountCode: "6010",
        creditAccountCode: "1010",
        memo: "Negative amount test",
      },
    });
    assert.equal(nonPositiveRes.status, 400, "Negative amounts must return HTTP 400");

    // 5. Accepts valid balanced compound journal entry (lines array) and guarantees DB parity sum(debit) === sum(credit)
    const balancedCompoundRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        memo: "Valid multi-line split expense test",
        lines: [
          { accountCode: "6010", debit: 200.00, credit: 0.00, lineMemo: "Supplies" },
          { accountCode: "6020", debit: 150.00, credit: 0.00, lineMemo: "Utilities" },
          { accountCode: "1010", debit: 0.00, credit: 350.00, lineMemo: "Cash paid" },
        ],
      },
    });
    assert.equal(
      balancedCompoundRes.status,
      201,
      `Valid compound balanced journal entry must return HTTP 201, got ${balancedCompoundRes.status}: ${balancedCompoundRes.text}`
    );
    const compoundEntryId = Number(balancedCompoundRes.data.entryId);
    assert.ok(Number.isSafeInteger(compoundEntryId) && compoundEntryId > 0, "Response must return valid entryId");
    createdJournalEntryIds.add(compoundEntryId);

    // Verify DB lines balance for compound entry
    const [lines] = await pool.execute(
      "SELECT SUM(debit) AS total_debit, SUM(credit) AS total_credit FROM journal_entry_lines WHERE journal_entry_id = ?",
      [compoundEntryId]
    );
    const totalDebit = Number(lines[0].total_debit);
    const totalCredit = Number(lines[0].total_credit);
    assert.equal(totalDebit, 350.00, "Total debits in DB must match 350.00");
    assert.equal(totalCredit, 350.00, "Total credits in DB must match 350.00");
    assert.equal(totalDebit, totalCredit, "Double-entry parity invariant violated in database lines!");

    // Verify trial balance reflects equilibrium
    const tbRes = await server.requestJson("/api/finances/trial-balance", {
      token: adminUser.token,
    });
    assert.equal(tbRes.status, 200);
    assert.equal(tbRes.data.isBalanced, true, "Trial balance isBalanced must be true");
  });

  // --------------------------------------------------------------------------
  // INVARIANT 2: DERIVED ACCOUNT BALANCES
  // --------------------------------------------------------------------------
  it("INVARIANT 2 (DERIVED ACCOUNT BALANCES): account balances cannot be arbitrarily set via API and are dynamically calculated from view_account_balances", async () => {
    // 1. Attempting to directly update or set account balances via API must be blocked with HTTP 405 Method Not Allowed
    const putRes = await server.requestJson("/api/finances/accounts/1", {
      method: "PUT",
      token: adminUser.token,
      body: { currentBalance: 9999999, balance: 9999999 },
    });
    assert.equal(
      putRes.status,
      405,
      `Directly mutating account balances must return HTTP 405 Method Not Allowed, got ${putRes.status}`
    );

    const patchRes = await server.requestJson("/api/finances/accounts/1010", {
      method: "PATCH",
      token: adminUser.token,
      body: { currentBalance: 9999999 },
    });
    assert.equal(
      patchRes.status,
      405,
      `Directly patching account balances must return HTTP 405 Method Not Allowed, got ${patchRes.status}`
    );

    // 2. Verify chart_of_accounts database schema contains NO stored balance column
    const [coaColumns] = await pool.execute("SHOW COLUMNS FROM chart_of_accounts");
    const balanceColumn = coaColumns.find((col) => /balance/i.test(col.Field) && col.Field !== "normal_balance");
    assert.equal(
      balanceColumn,
      undefined,
      "chart_of_accounts table must NEVER store a mutable balance column; balances must be dynamic"
    );

    // 3. Verify view_account_balances mathematical derivation for every account
    const [viewRows] = await pool.execute("SELECT * FROM view_account_balances");
    assert.ok(viewRows.length >= 10, "view_account_balances must return all chart of accounts");

    for (const row of viewRows) {
      const normal = String(row.normal_balance).toLowerCase();
      const debits = Number(row.total_debits || 0);
      const credits = Number(row.total_credits || 0);
      const expectedBalance = normal === "debit" ? Number((debits - credits).toFixed(2)) : Number((credits - debits).toFixed(2));
      const actualBalance = Number(Number(row.current_balance || 0).toFixed(2));
      assert.equal(
        actualBalance,
        expectedBalance,
        `view_account_balances dynamic derivation failed for account ${row.account_code} (${row.account_name}): expected ${expectedBalance}, got ${actualBalance}`
      );
    }

    // 4. Verify GET /api/finances/accounts returns derived balances matching the view
    const accRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(accRes.status, 200);
    const apiCashDrawer = accRes.data.accounts.find((a) => a.accountCode === "1010");
    const viewCashDrawer = viewRows.find((r) => r.account_code === "1010");
    assert.equal(
      Number(apiCashDrawer.balance),
      Number(viewCashDrawer.current_balance),
      "API account balance must match view_account_balances dynamic value"
    );
  });

  // --------------------------------------------------------------------------
  // INVARIANT 3: IMMUTABILITY & REVERSAL AUDIT
  // --------------------------------------------------------------------------
  it("INVARIANT 3 (IMMUTABILITY & REVERSAL AUDIT): blocks mutation/deletion of historical journal entries and enforces auditable reversals", async () => {
    // 1. Post an original journal entry
    const postRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        amount: 750.00,
        debitAccountCode: "6010",
        creditAccountCode: "1010",
        memo: "Original expense for immutability test",
      },
    });
    assert.equal(postRes.status, 201);
    const originalEntryId = Number(postRes.data.entryId);
    createdJournalEntryIds.add(originalEntryId);

    // 2. DELETE is strictly blocked with HTTP 405 Method Not Allowed
    const deleteRes = await server.requestJson(`/api/finances/journal-entries/${originalEntryId}`, {
      method: "DELETE",
      token: adminUser.token,
    });
    assert.equal(
      deleteRes.status,
      405,
      `Deleting historical journal entries must be blocked with HTTP 405, got ${deleteRes.status}`
    );

    // 3. PUT/PATCH is strictly blocked with HTTP 405 Method Not Allowed
    const putRes = await server.requestJson(`/api/finances/journal-entries/${originalEntryId}`, {
      method: "PUT",
      token: adminUser.token,
      body: { amount: 100 },
    });
    assert.equal(
      putRes.status,
      405,
      `Mutating historical journal entries must be blocked with HTTP 405, got ${putRes.status}`
    );

    // Verify original row is 100% intact in DB
    const [[origDbRow]] = await pool.execute(
      "SELECT * FROM journal_entries WHERE id = ?",
      [originalEntryId]
    );
    assert.ok(origDbRow, "Original journal entry must remain intact in database");
    assert.equal(origDbRow.is_reversal, 0, "Original entry must not be marked as reversal");

    // 4. Reverse disputed entry via POST /api/finances/journal-entries/:id/reverse
    const reverseRes = await server.requestJson(`/api/finances/journal-entries/${originalEntryId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Audited error in vendor charge" },
    });
    assert.equal(
      reverseRes.status,
      201,
      `Traceable reversal must return HTTP 201, got ${reverseRes.status}: ${reverseRes.text}`
    );
    const reversalEntryId = Number(reverseRes.data.reversalEntryId);
    assert.ok(Number.isSafeInteger(reversalEntryId) && reversalEntryId > 0);
    createdJournalEntryIds.add(reversalEntryId);

    // 5. Verify reversal DB integrity: debits and credits inverted, linkage preserved
    const [[revDbRow]] = await pool.execute(
      "SELECT * FROM journal_entries WHERE id = ?",
      [reversalEntryId]
    );
    assert.equal(revDbRow.is_reversal, 1, "Reversal entry must have is_reversal = 1");
    assert.equal(Number(revDbRow.reverses_entry_id), originalEntryId, "reverses_entry_id must point to original entry");

    const [origLines] = await pool.execute(
      "SELECT account_id, debit, credit FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY id ASC",
      [originalEntryId]
    );
    const [revLines] = await pool.execute(
      "SELECT account_id, debit, credit FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY id ASC",
      [reversalEntryId]
    );
    assert.equal(revLines.length, origLines.length, "Reversal entry line count must match original line count");

    for (let i = 0; i < origLines.length; i++) {
      assert.equal(revLines[i].account_id, origLines[i].account_id, "Reversed line account_id must match");
      assert.equal(Number(revLines[i].debit), Number(origLines[i].credit), "Reversal debit must equal original credit");
      assert.equal(Number(revLines[i].credit), Number(origLines[i].debit), "Reversal credit must equal original debit");
    }

    // 6. Attempting to reverse an entry that is already a reversal must be rejected with HTTP 400
    const doubleRevRes = await server.requestJson(`/api/finances/journal-entries/${reversalEntryId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Illegal double reversal" },
    });
    assert.equal(doubleRevRes.status, 400, "Cannot reverse an entry that is already a reversal");
  });

  // --------------------------------------------------------------------------
  // INVARIANT 4: CAPITAL INJECTION ISOLATION
  // --------------------------------------------------------------------------
  it("INVARIANT 4 (CAPITAL INJECTION ISOLATION): owner capital injection increases total store assets while P&L operating profit remains strictly 0.00", async () => {
    // 1. Read baseline accounts and P&L
    const baselineAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(baselineAccRes.status, 200);
    const baselineTotalAssets = Number(baselineAccRes.data.summary.totalStoreAssets);
    const baselineGcash = Number(baselineAccRes.data.summary.gcash);
    const baselineCapital = Number(baselineAccRes.data.summary.ownerCapital);

    const baselinePnlRes = await server.requestJson("/api/finances/reports/profit-and-loss", {
      token: adminUser.token,
    });
    assert.equal(baselinePnlRes.status, 200);
    const baselineGrossSales = Number(baselinePnlRes.data.grossSales);
    const baselineNetOperatingProfit = Number(baselinePnlRes.data.netOperatingProfit);

    // 2. Post owner capital injection of ₱50,000 into GCash (DR 1020, CR 3010)
    const injectRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "capital_injection",
        amount: 50000.00,
        debitAccountCode: "1020",
        creditAccountCode: "3010",
        memo: "Markie store expansion capital injection",
      },
    });
    assert.equal(injectRes.status, 201);
    createdJournalEntryIds.add(Number(injectRes.data.entryId));

    // 3. Assert total store assets increase by exactly ₱50,000
    const afterAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(afterAccRes.status, 200);
    const afterTotalAssets = Number(afterAccRes.data.summary.totalStoreAssets);
    const afterGcash = Number(afterAccRes.data.summary.gcash);
    const afterCapital = Number(afterAccRes.data.summary.ownerCapital);

    const assetDelta = Number((afterTotalAssets - baselineTotalAssets).toFixed(2));
    const gcashDelta = Number((afterGcash - baselineGcash).toFixed(2));
    const capitalDelta = Number((afterCapital - baselineCapital).toFixed(2));

    assert.equal(assetDelta, 50000.00, `Total store assets must increase by exactly 50000.00, got ${assetDelta}`);
    assert.equal(gcashDelta, 50000.00, "GCash asset account must increase by 50000.00");
    assert.equal(capitalDelta, 50000.00, "Owner equity capital must increase by 50000.00");

    // 4. Assert P&L operating profit remains strictly 0.00 (capital injection is NOT sales revenue!)
    const afterPnlRes = await server.requestJson("/api/finances/reports/profit-and-loss", {
      token: adminUser.token,
    });
    assert.equal(afterPnlRes.status, 200);
    const afterGrossSales = Number(afterPnlRes.data.grossSales);
    const afterNetOperatingProfit = Number(afterPnlRes.data.netOperatingProfit);

    assert.equal(
      afterGrossSales,
      baselineGrossSales,
      "Gross sales in P&L must be 100% unaffected by capital injection"
    );
    assert.equal(
      afterNetOperatingProfit,
      baselineNetOperatingProfit,
      "Net operating profit in P&L must be 100% unaffected by owner capital injection"
    );

    // 5. Assert Cash Flow statement categorizes it strictly as Financing Activity
    const cfRes = await server.requestJson("/api/finances/reports/cash-flow", {
      token: adminUser.token,
    });
    assert.equal(cfRes.status, 200);
    assert.ok(
      Number(cfRes.data.financingActivities.capitalInjected) >= 50000.00,
      "Cash flow statement must classify capital injection under Financing Activities"
    );

    // 6. Assert Balance Sheet satisfies Fundamental Accounting Equation: Assets === Liabilities + Equity
    const bsRes = await server.requestJson("/api/finances/reports/balance-sheet", {
      token: adminUser.token,
    });
    assert.equal(
      bsRes.status,
      200,
      `Balance Sheet report must return HTTP 200, got ${bsRes.status}: ${bsRes.text}`
    );
    assert.ok(bsRes.data.isBalanced, "Balance Sheet must report isBalanced === true");
    const totalAssets = Number(bsRes.data.totalAssets);
    const totalLiabilities = Number(bsRes.data.totalLiabilities);
    const totalEquity = Number(bsRes.data.totalEquity);
    assert.equal(
      totalAssets,
      Number((totalLiabilities + totalEquity).toFixed(2)),
      `Fundamental Accounting Equation failed: Assets (${totalAssets}) !== Liabilities (${totalLiabilities}) + Equity (${totalEquity})`
    );
  });

  // --------------------------------------------------------------------------
  // INVARIANT 5: OWNER DRAWING ISOLATION
  // --------------------------------------------------------------------------
  it("INVARIANT 5 (OWNER DRAWING ISOLATION): withdrawing personal profit reduces cash and total assets without recording an operating expense or business loss", async () => {
    // 1. Read baseline accounts and P&L
    const baselineAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(baselineAccRes.status, 200);
    const baselineTotalAssets = Number(baselineAccRes.data.summary.totalStoreAssets);
    const baselineCashDrawer = Number(baselineAccRes.data.summary.cashDrawer);
    const baselineDrawings = Number(baselineAccRes.data.summary.ownerDrawings);

    const baselinePnlRes = await server.requestJson("/api/finances/reports/profit-and-loss", {
      token: adminUser.token,
    });
    assert.equal(baselinePnlRes.status, 200);
    const baselineTotalOpex = Number(baselinePnlRes.data.totalOperatingExpenses);
    const baselineNetOperatingProfit = Number(baselinePnlRes.data.netOperatingProfit);

    // 2. Post owner personal drawing of ₱5,000 from Cash Drawer (DR 3020, CR 1010)
    const withdrawRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "owner_withdrawal",
        amount: 5000.00,
        debitAccountCode: "3020",
        creditAccountCode: "1010",
        memo: "Owner personal dividend withdrawal",
      },
    });
    assert.equal(withdrawRes.status, 201);
    createdJournalEntryIds.add(Number(withdrawRes.data.entryId));

    // 3. Assert total store assets and cash drawer drop by exactly ₱5,000
    const afterAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(afterAccRes.status, 200);
    const afterTotalAssets = Number(afterAccRes.data.summary.totalStoreAssets);
    const afterCashDrawer = Number(afterAccRes.data.summary.cashDrawer);
    const afterDrawings = Number(afterAccRes.data.summary.ownerDrawings);

    const assetReduction = Number((baselineTotalAssets - afterTotalAssets).toFixed(2));
    const cashReduction = Number((baselineCashDrawer - afterCashDrawer).toFixed(2));
    const drawingIncrease = Number((afterDrawings - baselineDrawings).toFixed(2));

    assert.equal(assetReduction, 5000.00, `Total store assets must decrease by exactly 5000.00, got ${assetReduction}`);
    assert.equal(cashReduction, 5000.00, `Cash drawer must decrease by exactly 5000.00, got ${cashReduction}`);
    assert.equal(drawingIncrease, 5000.00, "Owner drawings equity contra-account must increase by 5000.00");

    // 4. Assert P&L operating expenses and net profit remain strictly unchanged (Drawings are NOT business expenses!)
    const afterPnlRes = await server.requestJson("/api/finances/reports/profit-and-loss", {
      token: adminUser.token,
    });
    assert.equal(afterPnlRes.status, 200);
    const afterTotalOpex = Number(afterPnlRes.data.totalOperatingExpenses);
    const afterNetOperatingProfit = Number(afterPnlRes.data.netOperatingProfit);

    assert.equal(
      afterTotalOpex,
      baselineTotalOpex,
      "Owner drawings must NEVER be recorded as an operating expense in P&L!"
    );
    assert.equal(
      afterNetOperatingProfit,
      baselineNetOperatingProfit,
      "Net operating profit in P&L must be 100% unaffected by owner profit withdrawals!"
    );

    // 5. Assert Balance Sheet reflects owner drawings reducing total equity
    const bsRes = await server.requestJson("/api/finances/reports/balance-sheet", {
      token: adminUser.token,
    });
    assert.equal(
      bsRes.status,
      200,
      `Balance Sheet report must return HTTP 200, got ${bsRes.status}`
    );
    assert.ok(
      Number(bsRes.data.equity?.drawings || bsRes.data.equity?.ownerDrawings || 0) >= 5000.00,
      "Balance Sheet equity breakdown must show owner drawings >= 5000.00"
    );
  });

  // --------------------------------------------------------------------------
  // INVARIANT 6: RESTOCK ASSET NEUTRALITY
  // --------------------------------------------------------------------------
  it("INVARIANT 6 (RESTOCK ASSET NEUTRALITY): restocking ₱1,500 of ingredients with cash deducts ₱1,500 cash and adds ₱1,500 inventory valuation, keeping total assets 100% unchanged", async () => {
    // 1. Create a test inventory item
    const [itemResult] = await pool.execute(
      `INSERT INTO inventory_items (name, category, quantity, unit, unit_cost, maximum_stock)
       VALUES (?, 'Ingredients', 10.00, 'kg', 100.00, 50.00)`,
      [makeUniqueTag("RestockCoffeeBean")]
    );
    const itemId = itemResult.insertId;
    tracker.inventoryItemIds.add(itemId);

    // 2. Read baseline accounts
    const baselineAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(baselineAccRes.status, 200);
    const baselineTotalAssets = Number(baselineAccRes.data.summary.totalStoreAssets);
    const baselineCashDrawer = Number(baselineAccRes.data.summary.cashDrawer);
    const baselineInventoryValue = Number(baselineAccRes.data.summary.liveInventoryValue);

    // 3. Execute restock of 15 units with batch cost ₱1,500 via POST /api/inventory/:id/restock
    const restockRes = await server.requestJson(`/api/inventory/${itemId}/restock`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 15, batchCost: 1500.00 },
    });
    assert.equal(
      restockRes.status,
      200,
      `Restock request must succeed with HTTP 200, got ${restockRes.status}: ${restockRes.text}`
    );

    // 4. Verify that inventory restock automatically posts balanced journal entry
    const [restockEntries] = await pool.execute(
      `SELECT je.id, je.entry_type, je.memo
         FROM journal_entries je
        WHERE je.entry_type = 'inventory_restock'
        ORDER BY je.id DESC
        LIMIT 1`
    );
    assert.ok(
      restockEntries.length > 0,
      "Inventory restock MUST automatically post an 'inventory_restock' double-entry journal entry"
    );
    const restockEntryId = Number(restockEntries[0].id);
    createdJournalEntryIds.add(restockEntryId);

    const [restockLines] = await pool.execute(
      `SELECT jel.*, coa.account_code
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id = ?`,
      [restockEntryId]
    );
    const inventoryDebitLine = restockLines.find((l) => l.account_code === "1050" && Number(l.debit) === 1500.00);
    const cashCreditLine = restockLines.find((l) => l.account_code === "1010" && Number(l.credit) === 1500.00);
    assert.ok(inventoryDebitLine, "Restock must debit 1050 Merchandise Inventory for 1500.00");
    assert.ok(cashCreditLine, "Restock must credit 1010 Cash Drawer for 1500.00");

    // 5. Assert Total Store Assets remain 100% constant (Asset-Neutral Swap)
    const afterAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(afterAccRes.status, 200);
    const afterTotalAssets = Number(afterAccRes.data.summary.totalStoreAssets);
    const afterCashDrawer = Number(afterAccRes.data.summary.cashDrawer);
    const afterInventoryValue = Number(afterAccRes.data.summary.liveInventoryValue);

    const totalAssetDelta = Math.abs(afterTotalAssets - baselineTotalAssets);
    assert.ok(
      totalAssetDelta < 0.01,
      `Total store assets must remain 100% unchanged during inventory restock (expected delta 0.00, got ${totalAssetDelta})`
    );
    assert.equal(
      Number((baselineCashDrawer - afterCashDrawer).toFixed(2)),
      1500.00,
      "Cash drawer must decrease by exactly 1500.00"
    );
    assert.equal(
      Number((afterInventoryValue - baselineInventoryValue).toFixed(2)),
      1500.00,
      "Inventory valuation must increase by exactly 1500.00"
    );
  });

  // --------------------------------------------------------------------------
  // INVARIANT 7: ROLE-BASED SECURITY (RBAC)
  // --------------------------------------------------------------------------
  it("INVARIANT 7 (ROLE-BASED SECURITY): calling /api/finances/* as role 'staff' returns HTTP 403 Forbidden, role 'admin' gets HTTP 200", async () => {
    const protectedFinanceEndpoints = [
      { path: "/api/finances/accounts", method: "GET" },
      { path: "/api/finances/trial-balance", method: "GET" },
      { path: "/api/finances/journal-entries", method: "GET" },
      { path: "/api/finances/reports/profit-and-loss", method: "GET" },
      { path: "/api/finances/reports/cash-flow", method: "GET" },
      { path: "/api/finances/reports/balance-sheet", method: "GET" },
      { path: "/api/finances/reports/daily-reconciliation", method: "GET" },
    ];

    for (const ep of protectedFinanceEndpoints) {
      // 1. Unauthenticated (no token) -> 401 Unauthorized
      const unauthRes = await server.requestJson(ep.path, { method: ep.method, token: null });
      assert.equal(
        unauthRes.status,
        401,
        `Unauthenticated call to ${ep.path} must return HTTP 401, got ${unauthRes.status}`
      );

      // 2. Staff user token -> 403 Forbidden
      const staffRes = await server.requestJson(ep.path, { method: ep.method, token: staffUser.token });
      assert.equal(
        staffRes.status,
        403,
        `Staff role call to ${ep.path} must return HTTP 403 Forbidden, got ${staffRes.status}`
      );

      // 3. Admin user token -> 200 OK
      const adminRes = await server.requestJson(ep.path, { method: ep.method, token: adminUser.token });
      assert.equal(
        adminRes.status,
        200,
        `Admin role call to ${ep.path} must return HTTP 200, got ${adminRes.status}`
      );
    }

    // Also assert mutating endpoints reject staff with 403
    const staffPostRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: staffUser.token,
      body: {
        entryType: "operating_expense",
        amount: 100,
        debitAccountCode: "6010",
        creditAccountCode: "1010",
        memo: "Staff unauthorized post",
      },
    });
    assert.equal(staffPostRes.status, 403, "Staff role POST /api/finances/journal-entries must return HTTP 403");
  });

  // --------------------------------------------------------------------------
  // INVARIANT 8: BOD & EOD ASSET SNAPSHOT RECONCILIATION
  // --------------------------------------------------------------------------
  it("INVARIANT 8 (BOD & EOD ASSET SNAPSHOT): opening a shift takes a BOD snapshot and closing a shift takes an EOD snapshot with exact net asset delta", async () => {
    const today = getManilaDateString();
    createdSnapshotDates.add(today);
    await pool.execute("DELETE FROM store_daily_asset_snapshots WHERE business_date = ?", [today]);

    // 1. Open a cashier session via POST /api/sessions/open
    const openRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staffUser.token,
      body: { openingFloat: 1000.00, terminalLabel: "Counter Tala Invariant" },
    });
    assert.equal(
      openRes.status,
      201,
      `Opening session must return HTTP 201, got ${openRes.status}: ${openRes.text}`
    );
    const sessionId = Number(openRes.data.session.id);
    tracker.sessionIds.add(sessionId);

    // 2. Verify that opening the shift created or initialized a Beginning-of-Day (BOD) asset snapshot
    const [[bodSnapshot]] = await pool.execute(
      "SELECT * FROM store_daily_asset_snapshots WHERE business_date = ? LIMIT 1",
      [today]
    );
    assert.ok(
      bodSnapshot,
      `BOD asset snapshot must be automatically created in store_daily_asset_snapshots on shift open for date ${today}`
    );
    assert.equal(bodSnapshot.status, "open", "BOD snapshot status must be 'open'");
    assert.ok(Number(bodSnapshot.opening_total_assets) >= 0, "BOD opening_total_assets must be recorded");

    // Verify snapshot appears in admin daily reconciliation report
    const reconReportRes = await server.requestJson("/api/finances/reports/daily-reconciliation", {
      token: adminUser.token,
    });
    assert.equal(reconReportRes.status, 200);
    const todayReportItem = reconReportRes.data.items.find((item) => String(item.businessDate).startsWith(today));
    assert.ok(todayReportItem, "Daily reconciliation report must include today's open BOD snapshot");
    assert.equal(todayReportItem.status, "open");

    // 3. Close the shift with counted cash ₱1,200 via POST /api/sessions/:id/close
    const closeRes = await server.requestJson(`/api/sessions/${sessionId}/close`, {
      method: "POST",
      token: staffUser.token,
      body: { countedCash: 1200.00, closingNotes: "Shift closed by Tala test" },
    });
    assert.equal(
      closeRes.status,
      200,
      `Closing session must return HTTP 200, got ${closeRes.status}: ${closeRes.text}`
    );

    // 4. Verify that closing the shift committed an End-of-Day (EOD) asset snapshot
    const [[eodSnapshot]] = await pool.execute(
      "SELECT * FROM store_daily_asset_snapshots WHERE business_date = ? LIMIT 1",
      [today]
    );
    assert.ok(eodSnapshot, "EOD asset snapshot must exist in store_daily_asset_snapshots");
    assert.equal(eodSnapshot.status, "closed", "EOD asset snapshot status must transition to 'closed'");
    assert.ok(eodSnapshot.closing_total_assets !== null, "closing_total_assets must not be null");
    assert.ok(eodSnapshot.closing_liquid_assets !== null, "closing_liquid_assets must not be null");
    assert.ok(eodSnapshot.net_asset_delta !== null, "net_asset_delta must be computed and not null");

    // 5. Verify mathematical delta: net_asset_delta === closing_total_assets - opening_total_assets
    const openingTotal = Number(eodSnapshot.opening_total_assets);
    const closingTotal = Number(eodSnapshot.closing_total_assets);
    const recordedDelta = Number(eodSnapshot.net_asset_delta);
    const expectedDelta = Number((closingTotal - openingTotal).toFixed(2));

    assert.equal(
      recordedDelta,
      expectedDelta,
      `net_asset_delta mismatch: expected ${expectedDelta} (closing ${closingTotal} - opening ${openingTotal}), got ${recordedDelta}`
    );
  });
});
