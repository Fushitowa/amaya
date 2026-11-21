import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

describe("Owner's pay is drawings, never an expense (payroll plan P2.10)", () => {
  let server;
  const tracker = createCleanupTracker();

  before(async () => {
    server = await startTestServer({ unlockNetIncome: true });
  });

  after(async () => {
    try {
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  it("lowers cash and equity but leaves net income untouched", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    const pnl = async () => (await server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token: admin.token })).data;
    const ownerPay = async () => (await server.requestJson(`/api/payroll/owner-pay?year=${today.slice(0, 4)}`, { token: admin.token })).data;

    const topUp = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "capital_injection", amount: 5000, debitAccountCode: "1030", creditAccountCode: "3010", memo: "Owner pay test funds" },
    });
    assert.equal(topUp.status, 201, JSON.stringify(topUp.data));

    const beforePnl = await pnl();
    const beforePay = await ownerPay();
    const memo = makeUniqueTag("Owner pay");
    const res = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "owner_withdrawal", amount: 1234.5, debitAccountCode: "3020", creditAccountCode: "1030", memo },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));

    const afterPnl = await pnl();
    assert.equal(afterPnl.netIncome, beforePnl.netIncome, "net income unchanged");
    assert.equal(afterPnl.totalOperatingExpenses, beforePnl.totalOperatingExpenses, "no expense recorded");

    const lines = await pool.execute(
      `SELECT coa.account_code AS code, jel.debit, jel.credit FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id WHERE jel.journal_entry_id = ?`,
      [res.data.entryId],
    );
    const byCode = Object.fromEntries(lines[0].map((l) => [l.code, l]));
    assert.equal(Number(byCode["3020"].debit), 1234.5, "Owner's Drawings (equity) debited");
    assert.equal(Number(byCode["1030"].credit), 1234.5, "cash credited");

    const afterPay = await ownerPay();
    assert.equal(Math.round((afterPay.total - beforePay.total) * 100) / 100, 1234.5);
    assert.ok(afterPay.items.some((item) => item.memo === memo && item.paidFrom === "1030"));
  });
});
