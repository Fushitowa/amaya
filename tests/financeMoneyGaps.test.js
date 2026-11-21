import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { postBalancedEntry } from "../api/src/utils/ledgerService.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

// Money that used to never reach the books: paying VAT to BIR, buying equipment after day one,
// the opening drawer float, and the live expected cash on the staff report.
describe("Finance money gaps: VAT payment, equipment purchase, opening float, live expected cash", () => {
  let server;
  const tracker = createCleanupTracker();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

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

  const glBalance = async (code, side = "debit") => {
    const [[row]] = await pool.execute(
      `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS bal
         FROM journal_entry_lines jel JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE coa.account_code = ?`,
      [code],
    );
    const bal = Math.round(Number(row.bal) * 100) / 100;
    return side === "debit" ? bal : -bal;
  };
  const cashFlow = async (token) => (await server.requestJson(`/api/finances/reports/cash-flow?from=${today}&to=${today}`, { token })).data;
  const pnl = async (token) => (await server.requestJson(`/api/finances/reports/profit-and-loss?from=${today}&to=${today}`, { token })).data;
  const near = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 0.005, `${msg}: ${a} vs ${b}`);

  it("pays VAT to BIR: lowers VAT owed and cash, counts as tax in Money In & Out, never as an expense", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    // Give the books VAT owed and bank money to pay it with (as a VAT-enabled order would).
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await postBalancedEntry(connection, {
        entryType: "sales_revenue",
        memo: makeUniqueTag("VAT seed"),
        createdBy: admin.id,
        lines: [
          { accountCode: "1030", debit: 112, credit: 0, lineMemo: "seed" },
          { accountCode: "4010", debit: 0, credit: 100, lineMemo: "seed" },
          { accountCode: "2020", debit: 0, credit: 12, lineMemo: "seed" },
        ],
      });
      await connection.commit();
    } finally {
      connection.release();
    }

    const vatOwed = await glBalance("2020", "credit");
    assert.ok(vatOwed >= 12, "VAT owed is seeded");

    const tooMuch = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "ap_settlement", memo: "VAT overpay", lines: [
        { accountCode: "2020", debit: vatOwed + 1, credit: 0 },
        { accountCode: "1030", debit: 0, credit: vatOwed + 1 },
      ] },
    });
    assert.equal(tooMuch.status, 409, JSON.stringify(tooMuch.data));

    const handEntered = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "adjustment", memo: "Fake VAT", amount: 5, debitAccountCode: "1030", creditAccountCode: "2020" },
    });
    assert.equal(handEntered.status, 400, "VAT can't be added by hand");

    const beforeCf = await cashFlow(admin.token);
    const beforePnl = await pnl(admin.token);
    const bankBefore = await glBalance("1030");
    const paid = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "ap_settlement", memo: makeUniqueTag("VAT to BIR"), lines: [
        { accountCode: "2020", debit: 10, credit: 0 },
        { accountCode: "1030", debit: 0, credit: 10 },
      ] },
    });
    assert.equal(paid.status, 201, JSON.stringify(paid.data));

    near(await glBalance("2020", "credit"), vatOwed - 10, "VAT owed drops");
    near(await glBalance("1030"), bankBefore - 10, "bank drops");
    const afterCf = await cashFlow(admin.token);
    near(afterCf.operatingActivities.taxCashOutflow, beforeCf.operatingActivities.taxCashOutflow + 10, "counted as tax paid");
    near(afterCf.operatingActivities.opexCashOutflow, beforeCf.operatingActivities.opexCashOutflow, "not a running cost");
    const afterPnl = await pnl(admin.token);
    near(afterPnl.netIncome, beforePnl.netIncome, "profit unchanged");
  });

  it("buys equipment: adds to equipment, lowers cash, shows as investing and not as an expense", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const topUp = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "capital_injection", amount: 5000, debitAccountCode: "1030", creditAccountCode: "3010", memo: "Equipment test funds" },
    });
    assert.equal(topUp.status, 201, JSON.stringify(topUp.data));

    const wrongDebit = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "equipment_purchase", amount: 100, debitAccountCode: "6120", creditAccountCode: "1030", memo: "Not equipment" },
    });
    assert.equal(wrongDebit.status, 400);
    const onCredit = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "equipment_purchase", amount: 100, debitAccountCode: "1510", creditAccountCode: "3010", memo: "Not paid from money" },
    });
    assert.equal(onCredit.status, 400);

    const equipBefore = await glBalance("1510");
    const beforeCf = await cashFlow(admin.token);
    const beforePnl = await pnl(admin.token);
    const bought = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "equipment_purchase", amount: 1200, debitAccountCode: "1510", creditAccountCode: "1030", memo: makeUniqueTag("Grinder") },
    });
    assert.equal(bought.status, 201, JSON.stringify(bought.data));

    near(await glBalance("1510"), equipBefore + 1200, "equipment value grows");
    const afterCf = await cashFlow(admin.token);
    near(afterCf.investingActivities.equipmentPurchased, beforeCf.investingActivities.equipmentPurchased + 1200, "shown as equipment bought");
    near(afterCf.operatingActivities.opexCashOutflow, beforeCf.operatingActivities.opexCashOutflow, "not a running cost");
    const afterPnl = await pnl(admin.token);
    near(afterPnl.totalOperatingExpenses, beforePnl.totalOperatingExpenses, "no expense today");

    const history = await server.requestJson(`/api/finances/journal-entries?type=equipment_purchase&from=${today}&to=${today}`, { token: admin.token });
    assert.equal(history.status, 200);
    assert.ok(history.data.items.some((e) => e.id === bought.data.entryId || e.entryId === bought.data.entryId || Number(e.id) === Number(bought.data.entryId)));
  });

  it("checks the opening float against the books: small gaps post over/short, big gaps are flagged and never block", async (t) => {
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });
    const book = await server.requestJson("/api/sessions/drawer-book", { token: staff.token });
    assert.equal(book.status, 200, JSON.stringify(book.data));
    if (book.data.otherShiftOpen) {
      t.skip("another shift is open in the test database");
      return;
    }
    const review = Number(book.data.reviewLimit);
    if (!(review > 0)) {
      t.skip("review limit is zero in the test database");
      return;
    }

    // 1. Small gap: posted as a shortage and the books end up matching the drawer.
    const gap = Math.min(30, review);
    const float = Math.round((book.data.bookCash - gap) * 100) / 100;
    if (float < 0) {
      t.skip("test drawer balance too low for a shortage");
      return;
    }
    const opened = await server.requestJson("/api/sessions/open", {
      method: "POST", token: staff.token,
      body: { openingFloat: float, terminalLabel: "Gap Test", floatNote: "Recounted twice" },
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const session = opened.data.session;
    near(session.openingBookCash, book.data.bookCash, "book cash saved on shift");
    near(session.openingVariance, -gap, "opening shortage saved");
    const [[entry]] = await pool.execute(
      `SELECT je.id, SUM(CASE WHEN coa.account_code = '6040' THEN jel.debit ELSE 0 END) AS short6040
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.idempotency_key = ? GROUP BY je.id`,
      [`session:${session.id}:opening_variance`],
    );
    assert.ok(entry, "opening over/short was posted");
    near(entry.short6040, gap, "posted as cash short");

    const during = await server.requestJson("/api/sessions/drawer-book", { token: staff.token });
    assert.equal(during.data.otherShiftOpen, true);
    assert.equal(during.data.bookCash, null, "no figure while a shift is moving the drawer");

    const closed = await server.requestJson(`/api/sessions/${session.id}/close`, {
      method: "POST", token: staff.token, body: { countedCash: session.expectedCash },
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
    const after = await server.requestJson("/api/sessions/drawer-book", { token: staff.token });
    near(after.data.bookCash, float, "books now match the counted drawer");

    // 2. Big gap: shift still opens, nothing is posted, the owner is notified.
    const bigFloat = Math.round((after.data.bookCash + review + 50) * 100) / 100;
    const bigOpen = await server.requestJson("/api/sessions/open", {
      method: "POST", token: staff.token, body: { openingFloat: bigFloat, terminalLabel: "Big Gap Test" },
    });
    assert.equal(bigOpen.status, 201, JSON.stringify(bigOpen.data));
    const bigSession = bigOpen.data.session;
    near(bigSession.openingVariance, review + 50, "big gap saved on shift");
    const [[noEntry]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM journal_entries WHERE idempotency_key = ?",
      [`session:${bigSession.id}:opening_variance`],
    );
    assert.equal(Number(noEntry.n), 0, "big gap is not posted automatically");
    const [[notice]] = await pool.execute(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND event_key = ?",
      [admin.id, `drawer-opening-gap-${bigSession.id}`],
    );
    assert.equal(Number(notice.n), 1, "owner is told");
    const bigClosed = await server.requestJson(`/api/sessions/${bigSession.id}/close`, {
      method: "POST", token: staff.token, body: { countedCash: bigSession.expectedCash },
    });
    assert.equal(bigClosed.status, 200, JSON.stringify(bigClosed.data));
  });

  it("staff report shows an open shift's expected cash after cash paid out of the drawer", async (t) => {
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });
    // Put enough cash in the drawer's books for the ₱250 payout.
    const topUp = await server.requestJson("/api/finances/journal-entries", {
      method: "POST", token: admin.token,
      body: { entryType: "capital_injection", amount: 1000, debitAccountCode: "1010", creditAccountCode: "3010", memo: "Drawer test funds" },
    });
    assert.equal(topUp.status, 201, JSON.stringify(topUp.data));
    const book = await server.requestJson("/api/sessions/drawer-book", { token: staff.token });
    if (book.data.otherShiftOpen) {
      t.skip("another shift is open in the test database");
      return;
    }
    const float = Math.max(0, book.data.bookCash);
    if (float < 250) {
      t.skip("test drawer balance too low");
      return;
    }
    const opened = await server.requestJson("/api/sessions/open", {
      method: "POST", token: staff.token, body: { openingFloat: float, terminalLabel: "Live Cash Test", floatNote: "test" },
    });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const sessionId = opened.data.session.id;

    const spent = await server.requestJson("/api/finances/expense-records", {
      method: "POST", token: staff.token,
      body: { category: "lpg", description: "LPG tank refill", amount: 250, channel: "cash_counter" },
    });
    assert.equal(spent.status, 201, JSON.stringify(spent.data));

    const current = await server.requestJson("/api/sessions/current", { token: staff.token });
    near(current.data.session.expectedCash, float - 250, "shift bar subtracts the expense");

    const report = await server.requestJson(`/api/reports/staff/${staff.id}/activity?rangeKey=all`, { token: admin.token });
    assert.equal(report.status, 200, JSON.stringify(report.data));
    const row = report.data.sessions.find((s) => s.id === sessionId);
    assert.ok(row, "open shift is on the staff report");
    near(row.expectedCash, current.data.session.expectedCash, "staff report matches the shift bar");

    const closed = await server.requestJson(`/api/sessions/${sessionId}/close`, {
      method: "POST", token: staff.token, body: { countedCash: current.data.session.expectedCash },
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.data));
  });
});
