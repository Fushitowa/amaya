import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

describe("Finance Phase 1: journal PIN lock, reversal rules, liquid-funds guard", () => {
  let lockedServer;
  let openServer;
  let admin;
  const tracker = createCleanupTracker();
  const createdEntryIds = new Set();

  before(async () => {
    lockedServer = await startTestServer();
    openServer = await startTestServer({ unlockNetIncome: true });
    admin = await tracker.createUser({ role: "admin", username: makeUniqueTag("p1_fin_admin").toLowerCase() });
  });

  after(async () => {
    try {
      // Reversals reference their originals, so remove them first.
      const ids = [...createdEntryIds];
      if (ids.length) {
        const marks = ids.map(() => "?").join(",");
        const [reversals] = await pool.query(`SELECT id FROM journal_entries WHERE reverses_entry_id IN (${marks})`, ids);
        const all = [...ids, ...reversals.map((r) => Number(r.id))];
        const allMarks = all.map(() => "?").join(",");
        await pool.query(`DELETE FROM financial_payables WHERE incurred_journal_entry_id IN (${allMarks})`, all);
        await pool.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${allMarks})`, all);
        await pool.query(`DELETE FROM journal_entries WHERE reverses_entry_id IS NOT NULL AND id IN (${allMarks})`, all);
        await pool.query(`DELETE FROM journal_entries WHERE id IN (${allMarks})`, all);
      }
      await tracker.cleanup();
    } finally {
      await lockedServer?.close();
      await openServer?.close();
      await pool.end();
    }
  });

  async function post(body, { server = openServer } = {}) {
    const res = await server.requestJson("/api/finances/journal-entries", { method: "POST", token: admin.token, body });
    if (res.data?.entryId) createdEntryIds.add(Number(res.data.entryId));
    return res;
  }

  async function balanceOf(code) {
    const res = await openServer.requestJson("/api/finances/accounts", { token: admin.token });
    const account = res.data.accounts.find((a) => a.accountCode === code);
    return Number(account?.balance || 0);
  }

  it("hides amounts of equity entries from the journal while the PIN is locked, but not plain cash moves", async () => {
    const capital = await post({
      entryType: "capital_injection", amount: 321.45, debitAccountCode: "1030", creditAccountCode: "3010",
      memo: "P1 lock test capital",
    });
    assert.equal(capital.status, 201);
    const transfer = await post({
      entryType: "account_transfer", amount: 1.11, debitAccountCode: "1020", creditAccountCode: "1030",
      memo: "P1 lock test transfer",
    });
    assert.equal(transfer.status, 201);

    const locked = await lockedServer.requestJson("/api/finances/journal-entries?limit=50", { token: admin.token });
    assert.equal(locked.status, 200);
    assert.equal(locked.data.profitLocked, true);
    const lockedCapital = locked.data.items.find((e) => e.id === capital.data.entryId);
    assert.equal(lockedCapital.amountsLocked, true);
    assert.equal(lockedCapital.totalDebit, null);
    assert.ok(lockedCapital.lines.every((l) => l.debit === null && l.credit === null));
    const lockedTransfer = locked.data.items.find((e) => e.id === transfer.data.entryId);
    assert.equal(lockedTransfer.amountsLocked, false);
    assert.equal(lockedTransfer.totalDebit, 1.11);

    const open = await openServer.requestJson("/api/finances/journal-entries?limit=50", { token: admin.token });
    assert.equal(open.data.profitLocked, false);
    const openCapital = open.data.items.find((e) => e.id === capital.data.entryId);
    assert.equal(openCapital.totalDebit, 321.45);
  });

  it("requires an audit reason of at least 3 characters to reverse an entry", async () => {
    const entry = await post({
      entryType: "capital_injection", amount: 5, debitAccountCode: "1030", creditAccountCode: "3010",
      memo: "P1 reverse reason test",
    });
    assert.equal(entry.status, 201);
    for (const body of [{}, { reason: "  " }, { reason: "ab" }]) {
      const res = await openServer.requestJson(`/api/finances/journal-entries/${entry.data.entryId}/reverse`, {
        method: "POST", token: admin.token, body,
      });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const ok = await openServer.requestJson(`/api/finances/journal-entries/${entry.data.entryId}/reverse`, {
      method: "POST", token: admin.token, body: { reason: "Entered by mistake" },
    });
    assert.equal(ok.status, 201);
    const again = await openServer.requestJson(`/api/finances/journal-entries/${entry.data.entryId}/reverse`, {
      method: "POST", token: admin.token, body: { reason: "Second try" },
    });
    assert.equal(again.status, 409, "a second reversal must be rejected by the server");
  });

  it("refuses a transfer larger than the confirmed balance of the source account", async () => {
    const balance = await balanceOf("1040");
    const res = await post({
      entryType: "account_transfer", amount: balance + 1000, debitAccountCode: "1030", creditAccountCode: "1040",
      memo: "P1 overdraft transfer",
    });
    assert.equal(res.status, 409);
    assert.match(res.data.message, /Insufficient confirmed funds in account 1040/);
  });

  it("refuses to reverse money that came in once it has been moved out", async () => {
    const start = await balanceOf("1040");
    const amount = 777.77;
    const inject = await post({
      entryType: "capital_injection", amount, debitAccountCode: "1040", creditAccountCode: "3010",
      memo: "P1 reverse-guard capital",
    });
    assert.equal(inject.status, 201);
    const moveOut = await post({
      entryType: "account_transfer", amount: start + amount, debitAccountCode: "1030", creditAccountCode: "1040",
      memo: "P1 reverse-guard transfer out",
    });
    assert.equal(moveOut.status, 201);

    const blocked = await openServer.requestJson(`/api/finances/journal-entries/${inject.data.entryId}/reverse`, {
      method: "POST", token: admin.token, body: { reason: "Should be blocked" },
    });
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.message, /Insufficient confirmed funds in account 1040/);

    const undoTransfer = await openServer.requestJson(`/api/finances/journal-entries/${moveOut.data.entryId}/reverse`, {
      method: "POST", token: admin.token, body: { reason: "Put the money back" },
    });
    assert.equal(undoTransfer.status, 201);
    const allowed = await openServer.requestJson(`/api/finances/journal-entries/${inject.data.entryId}/reverse`, {
      method: "POST", token: admin.token, body: { reason: "Now the money is back" },
    });
    assert.equal(allowed.status, 201);
  });

  it("still posts a paid expense from a short account, but returns a warning", async () => {
    const balance = await balanceOf("1020");
    const amount = Math.max(balance, 0) + 123.45;
    const res = await post({
      entryType: "operating_expense", memo: "P1 short account expense",
      lines: [
        { accountCode: "6120", debit: amount, credit: 0 },
        { accountCode: "1020", debit: 0, credit: amount },
      ],
    });
    assert.equal(res.status, 201);
    assert.ok(Array.isArray(res.data.warnings) && res.data.warnings.length === 1);
    assert.match(res.data.warnings[0], /Account 1020/);

    const funded = await post({
      entryType: "operating_expense", memo: "P1 accrued expense (no cash)",
      lines: [
        { accountCode: "6120", debit: 2, credit: 0 },
        { accountCode: "2010", debit: 0, credit: 2 },
      ],
    });
    assert.equal(funded.status, 201);
    assert.deepEqual(funded.data.warnings, []);
  });
});
