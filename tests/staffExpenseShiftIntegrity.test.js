import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { getManilaDateString } from "../api/src/utils/ledgerService.js";
import { createCleanupTracker, startTestServer } from "./helpers/testServer.js";

function previousDay(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

describe("Staff expense recording: shift cash integrity and channel/date restrictions", () => {
  let server;
  const tracker = createCleanupTracker();

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    try {
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  const expense = (overrides = {}) => ({
    category: "lpg",
    description: "LPG tank refill",
    amount: 250,
    channel: "cash_counter",
    ...overrides,
  });

  it("requires an open shift before staff pay from the counter cash", async () => {
    const staff = await tracker.createUser({ role: "staff" });
    const res = await server.requestJson("/api/finances/expense-records", {
      method: "POST",
      token: staff.token,
      body: expense(),
    });
    assert.equal(res.status, 409);
  });

  it("blocks staff from GCash, bank, owner reserve, and backdated expenses", async () => {
    const staff = await tracker.createUser({ role: "staff" });
    for (const channel of ["gcash", "store_bank", "owner_reserve"]) {
      const res = await server.requestJson("/api/finances/expense-records", {
        method: "POST",
        token: staff.token,
        body: expense({ channel }),
      });
      assert.equal(res.status, 403, `staff must not record expenses from ${channel}`);
    }
    const backdated = await server.requestJson("/api/finances/expense-records", {
      method: "POST",
      token: staff.token,
      body: expense({ date: previousDay(getManilaDateString()) }),
    });
    assert.equal(backdated.status, 400);
  });

  it("deducts a counter-cash expense from the shift's expected cash so closing shows no false shortage", async () => {
    const staff = await tracker.createUser({ role: "staff" });
    const openRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staff.token,
      body: { openingFloat: 1000, terminalLabel: "Expense Counter" },
    });
    assert.equal(openRes.status, 201);
    const sessionId = Number(openRes.data.session.id);
    tracker.sessionIds.add(sessionId);

    const recordRes = await server.requestJson("/api/finances/expense-records", {
      method: "POST",
      token: staff.token,
      body: expense({ date: getManilaDateString() }),
    });
    assert.equal(recordRes.status, 201);
    const [[entry]] = await pool.execute("SELECT session_id FROM journal_entries WHERE id = ?", [recordRes.data.entryId]);
    assert.equal(Number(entry.session_id), sessionId, "expense must be linked to the payer's open shift");

    // The drawer physically holds 1000 - 250 = 750.
    const closeRes = await server.requestJson(`/api/sessions/${sessionId}/close`, {
      method: "POST",
      token: staff.token,
      body: { countedCash: 750, closingNotes: "Paid LPG from drawer" },
    });
    assert.equal(closeRes.status, 200);
    assert.equal(closeRes.data.session.expectedCash, 750);
    assert.equal(closeRes.data.session.variance, 0);

    const [[varianceEntries]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM journal_entries WHERE idempotency_key = ?",
      [`session:${sessionId}:cash_variance`],
    );
    assert.equal(Number(varianceEntries.n), 0, "no cash shortage entry may be posted for a correctly counted drawer");
  });

  it("records an expense once when the same clientRequestId is retried, and rejects a changed payload", async () => {
    const staff = await tracker.createUser({ role: "staff" });
    const openRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staff.token,
      body: { openingFloat: 500, terminalLabel: "Retry Counter" },
    });
    assert.equal(openRes.status, 201);
    tracker.sessionIds.add(Number(openRes.data.session.id));

    const clientRequestId = `expense-retry-${Date.now()}-abcdef`;
    const body = expense({ amount: 120, clientRequestId });
    const first = await server.requestJson("/api/finances/expense-records", { method: "POST", token: staff.token, body });
    const retry = await server.requestJson("/api/finances/expense-records", { method: "POST", token: staff.token, body });
    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.replayed, true);
    assert.equal(retry.data.entryId, first.data.entryId);

    const [[count]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM journal_entries WHERE idempotency_key = ?",
      [`expense:${staff.id}:${clientRequestId}`],
    );
    assert.equal(Number(count.n), 1, "retry must not create a second journal entry");

    const changed = await server.requestJson("/api/finances/expense-records", {
      method: "POST",
      token: staff.token,
      body: { ...body, amount: 999 },
    });
    assert.equal(changed.status, 409);
  });

  it("still lets the owner record bank-paid and backdated expenses", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const res = await server.requestJson("/api/finances/expense-records", {
      method: "POST",
      token: admin.token,
      body: expense({ channel: "store_bank", date: previousDay(getManilaDateString()) }),
    });
    assert.equal(res.status, 201);
  });
});
