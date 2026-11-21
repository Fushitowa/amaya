import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

function manilaDate(daysAgo = 0) {
  const base = new Date(Date.now() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(base);
}

describe("Finance Phase 2: dated expenses and balance sheet as-of date", () => {
  let server;
  let admin;
  const tracker = createCleanupTracker();
  const createdEntryIds = new Set();

  before(async () => {
    server = await startTestServer({ unlockNetIncome: true });
    admin = await tracker.createUser({ role: "admin", username: makeUniqueTag("p2_fin_admin").toLowerCase() });
  });

  after(async () => {
    try {
      const ids = [...createdEntryIds];
      if (ids.length) {
        const marks = ids.map(() => "?").join(",");
        await pool.query(`DELETE FROM financial_payables WHERE incurred_journal_entry_id IN (${marks})`, ids);
        await pool.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${marks})`, ids);
        await pool.query(`DELETE FROM journal_entries WHERE id IN (${marks})`, ids);
      }
      await tracker.cleanup();
    } finally {
      await server?.close();
      await pool.end();
    }
  });

  async function postExpense(extra = {}) {
    const res = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: admin.token,
      body: {
        entryType: "operating_expense",
        memo: "P2 dated expense",
        lines: [
          { accountCode: "6120", debit: 12.34, credit: 0 },
          { accountCode: "2010", debit: 0, credit: 12.34 },
        ],
        ...extra,
      },
    });
    if (res.data?.entryId) createdEntryIds.add(Number(res.data.entryId));
    return res;
  }

  it("rejects future, malformed and non-expense entry dates", async () => {
    assert.equal((await postExpense({ entryDate: manilaDate(-3) })).status, 400);
    assert.equal((await postExpense({ entryDate: "2026-13-45" })).status, 400);
    const transfer = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: admin.token,
      body: {
        entryType: "capital_injection", amount: 1, debitAccountCode: "1030", creditAccountCode: "3010",
        memo: "P2 date on non-expense", entryDate: manilaDate(2),
      },
    });
    assert.equal(transfer.status, 400);
  });

  it("dates an expense on a past day and keeps it out of earlier balance sheets", async () => {
    const entryDay = manilaDate(2);
    const dayBefore = manilaDate(3);
    const posted = await postExpense({ entryDate: entryDay });
    assert.equal(posted.status, 201);

    const [[row]] = await pool.query("SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS d FROM journal_entries WHERE id = ?", [posted.data.entryId]);
    assert.equal(row.d, entryDay);

    const before = await server.requestJson(`/api/finances/reports/balance-sheet?asOf=${dayBefore}`, { token: admin.token });
    const onDay = await server.requestJson(`/api/finances/reports/balance-sheet?asOf=${entryDay}`, { token: admin.token });
    assert.equal(before.status, 200);
    assert.equal(onDay.status, 200);
    assert.equal(onDay.data.isHistoric, true);
    assert.equal(onDay.data.asOfDate, entryDay);
    assert.equal(Math.round((onDay.data.totalLiabilities - before.data.totalLiabilities) * 100) / 100, 12.34);
  });

  it("validates the balance sheet as-of date and skips the live stock check for past days", async () => {
    assert.equal((await server.requestJson(`/api/finances/reports/balance-sheet?asOf=${manilaDate(-2)}`, { token: admin.token })).status, 400);
    assert.equal((await server.requestJson("/api/finances/reports/balance-sheet?asOf=not-a-date", { token: admin.token })).status, 400);

    const past = await server.requestJson(`/api/finances/reports/balance-sheet?asOf=${manilaDate(1)}`, { token: admin.token });
    assert.equal(past.status, 200);
    assert.equal(past.data.isHistoric, true);
    assert.equal(past.data.liveInventoryValue, null);
    assert.equal(past.data.inventoryValuationVariance, null);
    assert.equal(past.data.isBalanced, true, "a past balance sheet must still balance");

    const today = await server.requestJson(`/api/finances/reports/balance-sheet?asOf=${manilaDate(0)}`, { token: admin.token });
    assert.equal(today.data.isHistoric, false);
    assert.equal(typeof today.data.liveInventoryValue, "number");
    const plain = await server.requestJson("/api/finances/reports/balance-sheet", { token: admin.token });
    assert.equal(plain.data.totalAssets, today.data.totalAssets);
  });
});
