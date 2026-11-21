import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

// Old months nobody has data in, so closing them cannot touch real records.
const CLOSED_MONTH = "2019-11";
const OTHER_MONTH = "2019-12";

describe("Finance Phase 4: month close and journal search", () => {
  let openServer;
  let lockedServer;
  let admin;
  const tracker = createCleanupTracker();
  const createdEntryIds = new Set();

  async function clearClosures() {
    await pool.query("DELETE FROM period_closures WHERE period_month IN (?, ?)", [CLOSED_MONTH, OTHER_MONTH]);
  }

  before(async () => {
    openServer = await startTestServer({ unlockNetIncome: true });
    lockedServer = await startTestServer();
    admin = await tracker.createUser({ role: "admin", username: makeUniqueTag("p4_fin_admin").toLowerCase() });
    await clearClosures();
  });

  after(async () => {
    try {
      await clearClosures();
      const ids = [...createdEntryIds];
      if (ids.length) {
        const marks = ids.map(() => "?").join(",");
        await pool.query(`DELETE FROM financial_payables WHERE incurred_journal_entry_id IN (${marks})`, ids);
        await pool.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${marks})`, ids);
        await pool.query(`DELETE FROM journal_entries WHERE id IN (${marks})`, ids);
      }
      await tracker.cleanup();
    } finally {
      await openServer?.close();
      await lockedServer?.close();
      await pool.end();
    }
  });

  async function postExpense(entryDate, memo = "P4 period expense") {
    const res = await openServer.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: admin.token,
      body: {
        entryType: "operating_expense",
        memo,
        entryDate,
        lines: [
          { accountCode: "6120", debit: 7.77, credit: 0 },
          { accountCode: "2010", debit: 0, credit: 7.77 },
        ],
      },
    });
    if (res.data?.entryId) createdEntryIds.add(Number(res.data.entryId));
    return res;
  }

  const close = (server, month, body = {}) =>
    server.requestJson(`/api/finances/periods/${month}/close`, { method: "POST", token: admin.token, body });
  const reopen = (server, month, body) =>
    server.requestJson(`/api/finances/periods/${month}/reopen`, { method: "POST", token: admin.token, body });

  it("needs the Net Income PIN, a real month and a month that has ended", async () => {
    assert.equal((await close(lockedServer, CLOSED_MONTH)).status, 403);
    assert.equal((await close(openServer, "2019-13")).status, 400);
    const current = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date());
    assert.equal((await close(openServer, current)).status, 409);
    assert.equal((await reopen(lockedServer, CLOSED_MONTH, { reason: "no pin" })).status, 403);
  });

  it("blocks new entries dated in a closed month, allows other months, and unlocks on reopen", async () => {
    assert.equal((await postExpense(`${CLOSED_MONTH}-10`)).status, 201, "open before closing");

    const closed = await close(openServer, CLOSED_MONTH, { note: "P4 test close" });
    assert.equal(closed.status, 201, closed.text);
    assert.equal((await close(openServer, CLOSED_MONTH)).status, 409, "already closed");

    const blocked = await postExpense(`${CLOSED_MONTH}-20`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.message, /is closed/);

    assert.equal((await postExpense(`${OTHER_MONTH}-05`)).status, 201, "a different month stays open");

    const list = await openServer.requestJson("/api/finances/periods", { token: admin.token });
    assert.equal(list.status, 200);
    assert.equal(list.data.months.length, 12);
    assert.equal(list.data.months[0].status, "current");

    assert.equal((await reopen(openServer, CLOSED_MONTH, { reason: "x" })).status, 400, "reason needs 3 characters");
    assert.equal((await reopen(openServer, CLOSED_MONTH, { reason: "Found a missing receipt" })).status, 200);
    assert.equal((await reopen(openServer, CLOSED_MONTH, { reason: "Again" })).status, 409, "not closed any more");
    assert.equal((await postExpense(`${CLOSED_MONTH}-21`)).status, 201, "open again after reopening");
  });

  it("closing again after a reopen locks the month once more", async () => {
    assert.equal((await close(openServer, CLOSED_MONTH)).status, 201);
    assert.equal((await postExpense(`${CLOSED_MONTH}-22`)).status, 409);
    await reopen(openServer, CLOSED_MONTH, { reason: "Cleanup after test" });
  });

  it("searches the journal by note and protects amount filters behind the PIN", async () => {
    const tag = makeUniqueTag("P4find");
    const posted = await postExpense(undefined, `Receipt ${tag} for the search test`);
    assert.equal(posted.status, 201);

    const found = await openServer.requestJson(`/api/finances/journal-entries?q=${encodeURIComponent(tag)}`, { token: admin.token });
    assert.equal(found.status, 200);
    assert.equal(found.data.total, 1);
    assert.equal(found.data.items[0].id, posted.data.entryId);

    const none = await openServer.requestJson("/api/finances/journal-entries?q=zzz-no-such-note-zzz", { token: admin.token });
    assert.equal(none.data.total, 0);

    const percent = await openServer.requestJson("/api/finances/journal-entries?q=%25", { token: admin.token });
    assert.equal(percent.status, 200, "a literal percent sign must not act as a wildcard or break the query");

    const inRange = await openServer.requestJson(`/api/finances/journal-entries?q=${encodeURIComponent(tag)}&minAmount=7&maxAmount=8`, { token: admin.token });
    assert.equal(inRange.data.total, 1);
    const outOfRange = await openServer.requestJson(`/api/finances/journal-entries?q=${encodeURIComponent(tag)}&minAmount=100`, { token: admin.token });
    assert.equal(outOfRange.data.total, 0);

    const lockedAmount = await lockedServer.requestJson("/api/finances/journal-entries?minAmount=1", { token: admin.token });
    assert.equal(lockedAmount.status, 403);
    const lockedSearch = await lockedServer.requestJson(`/api/finances/journal-entries?q=${encodeURIComponent(tag)}`, { token: admin.token });
    assert.equal(lockedSearch.status, 200, "text search stays available while locked");
  });
});
