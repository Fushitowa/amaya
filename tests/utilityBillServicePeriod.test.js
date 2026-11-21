import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createNetIncomeAccessToken } from "../api/src/routes/finances.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";
import { estimateUncoveredMonth, splitServicePeriod } from "../shared/utilityBills.js";

const round2 = (value) => Math.round(value * 100) / 100;

describe("Utility bills are dated by service period (payroll plan O3.4 / O3.5)", () => {
  it("splits a bill across months by days, and the parts add up to the bill", () => {
    // Meralco-style bill: Oct 20 – Nov 19 = 12 days in October + 19 days in November.
    const parts = splitServicePeriod("2024-10-20", "2024-11-19", 3100, 310);
    assert.deepEqual(parts.map((p) => [p.month, p.days, p.amount, p.readingShare]), [
      ["2024-10", 12, 1200, 120],
      ["2024-11", 19, 1900, 190],
    ]);
    const odd = splitServicePeriod("2024-01-15", "2024-03-14", 1000.01);
    assert.equal(odd.length, 3);
    assert.equal(round2(odd.reduce((sum, p) => sum + p.amount, 0)), 1000.01, "rounding never loses a centavo");
    assert.equal(odd.reduce((sum, p) => sum + p.days, 0), 60);
  });

  it("estimates a missing month as last bill ÷ its days × uncovered days", () => {
    const last = { serviceFrom: "2024-10-20", serviceTo: "2024-11-19", amount: 3100 };
    assert.deepEqual(estimateUncoveredMonth(last, "2024-12", 0), { month: "2024-12", uncoveredDays: 31, dailyCost: 100, estimatedAmount: 3100 });
    assert.equal(estimateUncoveredMonth(last, "2024-11", 19).estimatedAmount, 1100, "only the 11 days after Nov 19");
    assert.equal(estimateUncoveredMonth(last, "2024-11", 30), null, "a fully covered month needs no estimate");
  });
});

describe("Utility bill API (payroll plan O3.4–O3.6)", () => {
  let server;
  let admin;
  const tracker = createCleanupTracker();
  const billIds = [];
  const meter = makeUniqueTag("MTR");

  before(async () => {
    server = await startTestServer();
    admin = await tracker.createUser({ role: "admin" });
  });

  after(async () => {
    try {
      if (billIds.length) {
        const marks = billIds.map(() => "?").join(",");
        const [rows] = await pool.execute(`SELECT payable_id FROM utility_bills WHERE id IN (${marks})`, billIds);
        await pool.execute(`DELETE FROM utility_bills WHERE id IN (${marks})`, billIds);
        const payableIds = rows.map((row) => row.payable_id).filter(Boolean);
        if (payableIds.length) {
          const pm = payableIds.map(() => "?").join(",");
          await pool.execute(`UPDATE journal_entries SET payable_id = NULL WHERE payable_id IN (${pm})`, payableIds);
          await pool.execute(`DELETE FROM financial_payables WHERE id IN (${pm})`, payableIds);
        }
      }
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  const pin = () => ({ "X-Net-Income-Token": createNetIncomeAccessToken(admin.id) });
  const api = (path, options = {}) => server.requestJson(`/api/finances${path}`, { token: admin.token, headers: pin(), ...options });

  async function pnlAccount(from, to, code) {
    const res = await api(`/reports/profit-and-loss?from=${from}&to=${to}`);
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return round2(Number(res.data.operatingExpenses.find((row) => row.accountCode === code)?.amount || 0));
  }

  async function journalCount() {
    const [[row]] = await pool.execute("SELECT COUNT(*) AS n FROM journal_entries");
    return Number(row.n);
  }

  let bill;
  let octBefore;
  let novBefore;

  it("records an unpaid Meralco bill: the cost lands ⅓ in October and ⅔ in November, owed in Payables", async () => {
    octBefore = await pnlAccount("2024-10-01", "2024-10-31", "6131");
    novBefore = await pnlAccount("2024-11-01", "2024-11-30", "6131");
    const res = await api("/utility-bills", {
      method: "POST",
      body: { utility: "electricity", provider: "Meralco", accountNumber: meter, serviceFrom: "2024-10-20", serviceTo: "2024-11-19", reading: 310, amount: 3100, dueDate: "2024-12-05" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    bill = res.data.bill;
    billIds.push(bill.id);
    assert.deepEqual(bill.parts.map((p) => [p.month, p.amount]), [["2024-10", 1200], ["2024-11", 1900]]);
    assert.equal(bill.readingUnit, "kWh");

    assert.equal(await pnlAccount("2024-10-01", "2024-10-31", "6131"), round2(octBefore + 1200));
    assert.equal(await pnlAccount("2024-11-01", "2024-11-30", "6131"), round2(novBefore + 1900));

    const [[payable]] = await pool.execute("SELECT * FROM financial_payables WHERE id = ?", [bill.payableId]);
    assert.equal(payable.liability_account_code, "2010");
    assert.equal(payable.status, "unpaid");
    assert.equal(Number(payable.original_amount), 3100);
    assert.equal(new Date(payable.due_date).toISOString().slice(0, 10) <= "2024-12-05", true);

    const [lines] = await pool.execute(
      `SELECT coa.account_code AS code, jel.debit, jel.credit, DATE_FORMAT(je.entry_date, '%Y-%m-%d') AS day
         FROM utility_bill_parts p JOIN journal_entries je ON je.id = p.journal_entry_id
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE p.bill_id = ? ORDER BY je.entry_date, coa.account_code`,
      [bill.id],
    );
    assert.deepEqual(lines.map((l) => [l.day, l.code, Number(l.debit), Number(l.credit)]), [
      ["2024-10-31", "2010", 0, 1200], ["2024-10-31", "6131", 1200, 0],
      ["2024-11-19", "2010", 0, 1900], ["2024-11-19", "6131", 1900, 0],
    ]);
  });

  it("refuses a second bill for an overlapping period on the same meter", async () => {
    const res = await api("/utility-bills", {
      method: "POST",
      body: { utility: "electricity", provider: "Meralco", accountNumber: meter, serviceFrom: "2024-11-10", serviceTo: "2024-12-09", amount: 500 },
    });
    assert.equal(res.status, 409);
  });

  it("estimates December while its bill is not in, without posting anything", async () => {
    const before = await journalCount();
    const res = await api("/utility-bills/estimates?month=2024-12");
    assert.equal(res.status, 200);
    assert.equal(res.data.posted, false);
    const estimate = res.data.items.find((item) => item.utility === "electricity");
    assert.ok(estimate, "electricity had a bill last month");
    assert.equal(estimate.estimatedAmount, 3100);
    const pnl = await api("/reports/profit-and-loss?from=2024-12-01&to=2024-12-31");
    assert.ok(pnl.data.utilityEstimates.some((item) => item.utility === "electricity" && item.estimatedAmount === 3100));
    assert.equal(await journalCount(), before, "estimates are shown, never posted");
  });

  it("records a bill paid now: the payable is settled from the bank today", async () => {
    const res = await api("/utility-bills", {
      method: "POST",
      body: { utility: "water", provider: "Water district", accountNumber: meter, serviceFrom: "2024-11-01", serviceTo: "2024-11-30", reading: 18, amount: 640, paidNow: true, channel: "store_bank" },
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    billIds.push(res.data.bill.id);
    assert.equal(res.data.bill.payableStatus, "paid");
    const [[settlement]] = await pool.execute(
      `SELECT SUM(CASE WHEN coa.account_code = '2010' THEN jel.debit ELSE 0 END) AS ap, SUM(CASE WHEN coa.account_code = '1030' THEN jel.credit ELSE 0 END) AS bank
         FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.payable_id = ? AND je.entry_type = 'ap_settlement'`,
      [res.data.bill.payableId],
    );
    assert.equal(Number(settlement.ap), 640);
    assert.equal(Number(settlement.bank), 640);

    const insight = await api("/utility-bills/insights?utility=water&month=2024-11");
    assert.equal(insight.status, 200);
    assert.equal(insight.data.thisMonth.usage, 18);
    assert.equal(insight.data.thisMonth.costPerUnit, round2(640 / 18));
  });

  it("will not reverse one month of a bill from the Journal", async () => {
    const res = await api(`/journal-entries/${bill.parts[0].journalEntryId}/reverse`, { method: "POST", body: { reason: "test" } });
    assert.equal(res.status, 409);
  });

  it("voids the whole bill: both months go back to where they were and the payable is voided", async () => {
    const res = await api(`/utility-bills/${bill.id}/void`, { method: "POST", body: { reason: "test" } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.bill.status, "voided");
    assert.equal(await pnlAccount("2024-10-01", "2024-10-31", "6131"), octBefore);
    assert.equal(await pnlAccount("2024-11-01", "2024-11-30", "6131"), novBefore);
    const [[payable]] = await pool.execute("SELECT status FROM financial_payables WHERE id = ?", [bill.payableId]);
    assert.equal(payable.status, "voided");
  });

  it("rejects non-utility pages and bad periods", async () => {
    const wrong = await api("/utility-bills", { method: "POST", body: { utility: "rent", provider: "X", serviceFrom: "2024-10-01", serviceTo: "2024-10-31", amount: 100 } });
    assert.equal(wrong.status, 400);
    const backwards = await api("/utility-bills", { method: "POST", body: { utility: "water", provider: "X", serviceFrom: "2024-10-31", serviceTo: "2024-10-01", amount: 100 } });
    assert.equal(backwards.status, 400);
  });

  it("lists LPG tanks taken from inventory with days per tank", async () => {
    const res = await api("/utility-bills/lpg-tanks");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.items));
  });
});
