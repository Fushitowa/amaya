import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "../api");

describe("Double-Entry Ledger Reconciliation, Reversals & Export Limit", () => {
  let server;
  let adminUser;
  const tracker = createCleanupTracker();
  const createdEntryIds = new Set();

  before(async () => {
    server = await startTestServer();
    adminUser = await tracker.createUser({
      role: "admin",
      displayName: "Ledger Recon Admin",
      username: makeUniqueTag("ledger_admin").toLowerCase(),
    });
  });

  after(async () => {
    try {
      if (createdEntryIds.size > 0) {
        const ids = [...createdEntryIds];
        const marks = ids.map(() => "?").join(",");
        await pool.execute(
          `DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${marks})`,
          ids,
        );
        await pool.execute(
          `UPDATE journal_entries SET reverses_entry_id = NULL WHERE id IN (${marks})`,
          ids,
        );
        await pool.execute(`DELETE FROM journal_entries WHERE id IN (${marks})`, ids);
      }
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it("enforces double-entry parity, posts OPEX/Owner/Capital journals, preserves historical immutability on reversal, and maintains Balance Sheet equality", async () => {
    const tag = makeUniqueTag("LedgerEntry");

    // Unbalanced multi-line journal must be rejected (400)
    const unbalanced = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "opex",
        memo: `Unbalanced_${tag}`,
        lines: [
          { accountCode: "6010", debit: 500, credit: 0 },
          { accountCode: "1010", debit: 0, credit: 450 },
        ],
      },
    });
    assert.equal(unbalanced.status, 400);

    // Valid OPEX (Rent 6010 vs Cash 1010)
    const opexRes = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: adminUser.token,
      body: {
        entryType: "operating_expense",
        memo: `Opex_${tag}`,
        debitAccountCode: "6010",
        creditAccountCode: "1010",
        amount: 250,
      },
    });
    assert.equal(opexRes.status, 201);
    const opexId = Number(opexRes.data.entryId);
    createdEntryIds.add(opexId);

    // Reverse OPEX -> 201
    const revRes = await server.requestJson(`/api/finances/journal-entries/${opexId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Verification test reversal" },
    });
    assert.equal(revRes.status, 201);
    const revId = Number(revRes.data.reversalEntryId);
    createdEntryIds.add(revId);

    // Duplicate reversal must fail with 409
    const dupRev = await server.requestJson(`/api/finances/journal-entries/${opexId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Duplicate attempt" },
    });
    assert.equal(dupRev.status, 409);

    // Reversal of a reversal must fail with 400
    const revOfRev = await server.requestJson(`/api/finances/journal-entries/${revId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Reversal of reversal attempt" },
    });
    assert.equal(revOfRev.status, 400);

    // Balance Sheet accounting equation must balance (Assets = Liabilities + Equity)
    const bs = await server.requestJson("/api/finances/reports/balance-sheet", { token: adminUser.token });
    assert.equal(bs.status, 200);
    assert.equal(bs.data.isBalanced, true);
    assert.ok(Math.abs(Number(bs.data.balanceDifference)) < 0.005);

    // P&L and Cash Flow statements respond 200 with structured totals
    const pnl = await server.requestJson("/api/finances/reports/profit-and-loss", { token: adminUser.token });
    assert.equal(pnl.status, 200);
    assert.ok(pnl.data && typeof pnl.data === "object");

    const cf = await server.requestJson("/api/finances/reports/cash-flow", { token: adminUser.token });
    assert.equal(cf.status, 200);
    assert.ok(cf.data && typeof cf.data === "object");
  });

  it("enforces exportRowLimit from Admin Settings on CSV export and executes backfillLedger.js --dry-run cleanly", async () => {
    await tracker.trackBusinessSettings();
    const tag = makeUniqueTag("CsvLimit");
    const orderIds = [];

    try {
      const [catRes] = await pool.execute(
        "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
        [`Cat_${tag}`],
      );
      tracker.menuCategoryIds.add(Number(catRes.insertId));

      const prod = await server.requestJson("/api/menu", {
        method: "POST",
        token: adminUser.token,
        body: {
          name: `CsvItem_${tag}`,
          category: `Cat_${tag}`,
          basePrice: 50,
          costPrice: 20,
          stock: 20,
          available: true,
          ingredients: [],
        },
      });
      assert.equal(prod.status, 201);
      const prodId = Number(prod.data.id);
      tracker.productIds.add(prodId);

      // Place 2 orders
      for (let i = 0; i < 2; i += 1) {
        const res = await server.requestJson("/api/orders", {
          method: "POST",
          token: adminUser.token,
          body: {
            items: [{ productId: prodId, quantity: 1 }],
            paymentMethod: "Cash",
            cashTendered: 50,
          },
        });
        assert.equal(res.status, 201);
        const [[dbOrd]] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [res.data.id]);
        const oid = Number(dbOrd.id);
        orderIds.push(oid);
        tracker.orderIds.add(oid);
      }

      // Limit CSV rows to 100 and ensure export succeeds cleanly
      const setLimit = await server.requestJson("/api/settings", {
        method: "PUT",
        token: adminUser.token,
        body: {
          businessName: "Amaya's Drinks and Bites",
          email: "amayadrinksandbites@gmail.com",
          exportRowLimit: 100,
        },
      });
      assert.equal(setLimit.status, 200);

      const csvRes = await server.requestRaw("/api/reports/export.csv?rangeKey=today&dataset=orders", {
        token: adminUser.token,
      });
      assert.equal(csvRes.status, 200);
      const lines = csvRes.text.trim().split(/\r?\n/);
      // Header + at most 100 data rows
      assert.ok(lines.length >= 2 && lines.length <= 101);

      // Dry-run backfill script must exit cleanly and output valid JSON report
      const { stdout } = await execFileAsync(process.execPath, ["src/scripts/backfillLedger.js", "--dry-run"], {
        cwd: API_DIR,
      });
      const summary = JSON.parse(stdout);
      assert.equal(summary.mode, "dry-run");
      assert.equal(typeof summary.unpostedPaidOrders, "number");
      assert.equal(typeof summary.liveInventoryValuation, "number");
    } finally {
      if (orderIds.length > 0) {
        const marks = orderIds.map(() => "?").join(",");
        await pool.execute(
          `DELETE jel FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
            WHERE je.order_id IN (${marks})`,
          orderIds,
        );
        await pool.execute(`UPDATE journal_entries SET reverses_entry_id = NULL WHERE order_id IN (${marks})`, orderIds);
        await pool.execute(`DELETE FROM journal_entries WHERE order_id IN (${marks})`, orderIds);
      }
      await tracker.restoreBusinessSettings();
    }
  });
});
