import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createNetIncomeAccessToken } from "../api/src/routes/finances.js";
import { summarizeIncomeStatementLines } from "../api/src/utils/ledgerService.js";
import { createCleanupTracker, startTestServer } from "./helpers/testServer.js";
import {
  EXPENSE_NAV_CATEGORIES,
  EXPENSE_NAV_TREE,
  LEGACY_ACCOUNT_OWNER,
  getExpenseNavCategory,
} from "../shared/expenseNavigation.js";

const round2 = (value) => Math.round(value * 100) / 100;

describe("Operating costs follow the restaurant standard, USAR (payroll plan Phase 3B)", () => {
  let server;
  let admin;
  const tracker = createCleanupTracker();

  before(async () => {
    server = await startTestServer();
    admin = await tracker.createUser({ role: "admin" });
  });

  after(async () => {
    try {
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  const pin = () => ({ "X-Net-Income-Token": createNetIncomeAccessToken(admin.id) });

  it("gives every expense and occupancy account exactly one page", async () => {
    const [accounts] = await pool.execute(
      "SELECT account_code FROM chart_of_accounts WHERE is_active = TRUE AND report_section IN ('opex', 'occupancy')",
    );
    const leafSlugs = new Set(EXPENSE_NAV_TREE.flatMap((node) => (node.children.length ? node.children : [node.slug])));
    for (const { account_code: code } of accounts) {
      const owner = LEGACY_ACCOUNT_OWNER[code];
      assert.ok(owner, `account ${code} has no expense page`);
      assert.ok(leafSlugs.has(owner), `account ${code} belongs to the folder ${owner}, not a page`);
    }
  });

  it("files accounts the USAR way: rent is occupancy, internet is G&A, trash is a utility", async () => {
    const [rows] = await pool.execute(
      "SELECT account_code, report_section, expense_group FROM chart_of_accounts WHERE account_code IN ('6120', '6125', '6134', '6135', '6040', '6150')",
    );
    const byCode = Object.fromEntries(rows.map((row) => [row.account_code, row]));
    assert.equal(byCode["6120"].report_section, "occupancy");
    assert.equal(byCode["6125"].report_section, "occupancy");
    assert.equal(byCode["6134"].expense_group, "General & Administrative (G&A)");
    assert.equal(byCode["6135"].expense_group, "Utilities");
    assert.equal(byCode["6040"].expense_group, "General & Administrative (G&A)");
    assert.equal(byCode["6150"].expense_group, "Marketing");
    assert.equal(LEGACY_ACCOUNT_OWNER["6120"], "rent");
    assert.equal(LEGACY_ACCOUNT_OWNER["6134"], "internet");
    assert.equal(LEGACY_ACCOUNT_OWNER["6040"], "cash-over-short");
  });

  it("posts a Utilities folder record to 6130, never the legacy 6020", () => {
    assert.equal(getExpenseNavCategory("utilities").accountCodes[0], "6130");
    assert.equal(getExpenseNavCategory("other-utilities").accountCodes[0], "6130");
    for (const category of EXPENSE_NAV_CATEGORIES) {
      assert.notEqual(category.accountCodes[0], "6020", `${category.slug} would post to the legacy 6020 account`);
    }
  });

  it("works out prime cost, controllable income and occupancy without changing net income", () => {
    const row = (code, section, group, debit, credit = 0) => ({
      account_code: code, account_name: code, report_section: section, expense_group: group, total_debit: debit, total_credit: credit,
    });
    const pnl = summarizeIncomeStatementLines([
      row("4010", "revenue", null, 0, 1000),
      row("5010", "cogs", null, 300),
      row("6111", "opex", "Labor & Payroll", 200),
      row("6131", "opex", "Utilities", 50),
      row("6150", "opex", "Marketing", 20),
      row("6120", "occupancy", "Occupancy", 100),
    ]);
    assert.equal(pnl.laborCost, 200);
    assert.equal(pnl.primeCost, 500);
    assert.equal(pnl.primeCostPercent, 50);
    assert.equal(pnl.controllableExpenses, 70);
    assert.equal(pnl.controllableIncome, 430);
    assert.equal(pnl.totalOccupancy, 100);
    assert.equal(pnl.utilitiesPercent, 5);
    assert.equal(pnl.totalOperatingExpenses, 370, "occupancy still counts in total operating expenses");
    assert.equal(pnl.netIncome, 330);
    assert.equal(pnl.netIncome, pnl.controllableIncome - pnl.totalOccupancy);
    assert.equal(pnl.usarGroups.find((g) => g.key === "occupancy").accounts[0].accountCode, "6120");
  });

  it("puts rent below controllable income, and the Budget Overview total equals P&L operating expenses", async () => {
    // A quiet month far in the past keeps other tests' records out of the comparison.
    const year = 2001 + Math.floor(Math.random() * 9);
    const monthNumber = 1 + Math.floor(Math.random() * 12);
    const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const date = `${month}-10`;
    const records = [
      ["electricity", 1500],
      ["rent", 8000],
      ["marketing", 600],
      ["internet", 1299],
      ["other-utilities", 250],
      ["building-insurance-and-taxes", 400],
      ["miscellaneous", 75.5],
    ];
    for (const [category, amount] of records) {
      const res = await server.requestJson("/api/finances/expense-records", {
        method: "POST", token: admin.token,
        body: { category, description: `USAR test ${category}`, amount, date, channel: "store_bank" },
      });
      assert.equal(res.status, 201, `${category}: ${JSON.stringify(res.data)}`);
    }

    const health = await server.requestJson(`/api/finances/expense-budgets/health?month=${month}`, { token: admin.token });
    assert.equal(health.status, 200);
    const bySlug = Object.fromEntries(health.data.items.map((item) => [item.category, item]));
    const boardTotal = round2(EXPENSE_NAV_TREE.reduce((sum, node) => sum + Number(bySlug[node.slug].spent || 0), 0));

    const pnl = await server.requestJson(`/api/finances/reports/profit-and-loss?from=${month}-01&to=${month}-${lastDay}`, { token: admin.token, headers: pin() });
    assert.equal(pnl.status, 200);
    assert.equal(boardTotal, round2(pnl.data.totalOperatingExpenses), "Budget Overview total = P&L operating expenses");
    assert.equal(bySlug.occupancy.spent, 8400);
    assert.equal(bySlug.rent.spent, 8000);
    assert.equal(bySlug["general-and-administrative"].spent >= 1299, true);

    assert.equal(pnl.data.totalOccupancy, 8400);
    assert.equal(
      round2(pnl.data.controllableIncome - pnl.data.totalOccupancy - pnl.data.depreciation),
      round2(pnl.data.netIncomeBeforeTax),
      "occupancy sits between controllable income and profit before tax",
    );
    const occupancy = pnl.data.usarGroups.find((group) => group.key === "occupancy");
    assert.deepEqual(occupancy.accounts.map((a) => a.accountCode).sort(), ["6120", "6125"]);
    const utilities = pnl.data.usarGroups.find((group) => group.key === "utilities");
    assert.ok(utilities.accounts.some((a) => a.accountCode === "6130"));
    assert.ok(!utilities.accounts.some((a) => a.accountCode === "6134"), "internet is not a utility");
  });

  it("refuses manual records on the read-only Cash Over/Short page", async () => {
    const res = await server.requestJson("/api/finances/expense-records", {
      method: "POST", token: admin.token,
      body: { category: "cash-over-short", description: "test", amount: 10, channel: "store_bank" },
    });
    assert.equal(res.status, 400);
  });
});
