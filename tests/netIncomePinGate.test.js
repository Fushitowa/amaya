import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createNetIncomeAccessToken } from "../api/src/routes/finances.js";
import { createCleanupTracker, startTestServer } from "./helpers/testServer.js";

describe("Net Income PIN gate", () => {
  let server;
  const tracker = createCleanupTracker();

  before(async () => {
    // Deliberately NOT unlocked: this suite checks the locked view.
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

  it("hides Net Income without a PIN token and shows it with a valid one", async () => {
    const admin = await tracker.createUser({ role: "admin" });

    const locked = await server.requestJson("/api/finances/reports/profit-and-loss", { token: admin.token });
    assert.equal(locked.status, 200);
    assert.equal(locked.data.netIncome, null);
    assert.equal(locked.data.accountingNetIncome, null);

    const lockedAccounts = await server.requestJson("/api/finances/accounts", { token: admin.token });
    assert.equal(lockedAccounts.status, 200);
    assert.equal(lockedAccounts.data.summary.netIncome, null);
    assert.equal(lockedAccounts.data.summary.baseCapitalMoney, null);

    const unlocked = await server.requestJson("/api/finances/reports/profit-and-loss", {
      token: admin.token,
      headers: { "X-Net-Income-Token": createNetIncomeAccessToken(admin.id) },
    });
    assert.equal(unlocked.status, 200);
    assert.equal(typeof unlocked.data.netIncome, "number");
  });

  it("hides every figure Net Income could be worked out from while locked (F5)", async () => {
    const admin = await tracker.createUser({ role: "admin" });

    const pnl = await server.requestJson("/api/finances/reports/profit-and-loss", { token: admin.token });
    assert.equal(pnl.status, 200);
    assert.equal(pnl.data.profitLocked, true);
    assert.equal(typeof pnl.data.netSales, "number", "sales stay visible");
    for (const key of ["cogs", "grossProfit", "totalOperatingExpenses", "depreciation", "tax", "ebitdaOperatingIncome", "netIncomeBeforeTax"]) {
      assert.equal(pnl.data[key], null, `P&L ${key} must be hidden while locked`);
    }
    assert.deepEqual(pnl.data.operatingExpenses, []);

    const accounts = await server.requestJson("/api/finances/accounts", { token: admin.token });
    assert.equal(accounts.status, 200);
    assert.equal(accounts.data.summary.profitLocked, true);
    for (const key of ["grossProfit", "cogs", "totalOperatingExpenses", "depreciation", "tax", "totalCogsAndExpenses"]) {
      assert.equal(accounts.data.summary[key], null, `accounts summary ${key} must be hidden while locked`);
    }
    assert.equal(typeof accounts.data.summary.totalStoreAssets, "number", "store assets stay visible");
    assert.ok(accounts.data.accounts.some((account) => account.category === "expense"), "expense accounts stay listed for the expense forms");
    assert.ok(
      accounts.data.accounts
        .filter((account) => !["asset", "liability"].includes(account.category))
        .every((account) => account.balance === null),
      "revenue, expense and equity account balances must be hidden while locked",
    );

    const balanceSheet = await server.requestJson("/api/finances/reports/balance-sheet", { token: admin.token });
    assert.equal(balanceSheet.status, 200);
    assert.equal(balanceSheet.data.totalEquity, null);
    assert.ok(Object.values(balanceSheet.data.equity).every((value) => value === null));
    assert.equal(typeof balanceSheet.data.totalAssets, "number");

    const trialBalance = await server.requestJson("/api/finances/trial-balance", { token: admin.token });
    assert.equal(trialBalance.status, 403);

    const unlockedTrialBalance = await server.requestJson("/api/finances/trial-balance", {
      token: admin.token,
      headers: { "X-Net-Income-Token": createNetIncomeAccessToken(admin.id) },
    });
    assert.equal(unlockedTrialBalance.status, 200);
  });

  it("rejects a PIN token issued to a different user", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const other = await tracker.createUser({ role: "admin" });
    const res = await server.requestJson("/api/finances/reports/profit-and-loss", {
      token: admin.token,
      headers: { "X-Net-Income-Token": createNetIncomeAccessToken(other.id) },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.netIncome, null);
  });

  it("hides labor and USAR figures while locked (payroll plan P3.5 / O3.7)", async () => {
    const admin = await tracker.createUser({ role: "admin" });

    const pnl = await server.requestJson("/api/finances/reports/profit-and-loss", { token: admin.token });
    assert.equal(pnl.status, 200);
    for (const key of ["laborCost", "laborPercent", "primeCost", "primeCostPercent", "controllableExpenses", "controllableIncome", "controllableIncomePercent", "utilitiesCost", "totalOccupancy", "occupancyPercent", "restaurantOperatingIncome"]) {
      assert.equal(pnl.data[key], null, `P&L ${key} must be hidden while locked`);
    }
    assert.deepEqual(pnl.data.usarGroups, []);
    assert.deepEqual(pnl.data.utilityEstimates, []);

    const summary = await server.requestJson("/api/reports/financial-summary?rangeKey=30d", { token: admin.token });
    assert.equal(summary.status, 200);
    assert.equal(summary.data.summary.laborLocked, true);
    for (const key of ["laborCost", "laborPercent", "primeCost", "primeCostPercent", "salesPerLaborHour", "laborHours", "utilitiesPercent", "occupancyPercent", "controllableIncome", "controllableIncomePercent"]) {
      assert.equal(summary.data.summary[key], null, `financial-summary ${key} must be hidden while locked`);
    }

    const staff = await server.requestJson("/api/reports/staff-performance?rangeKey=30d", { token: admin.token });
    assert.equal(staff.data.laborLocked, true);
    assert.ok(staff.data.staff.every((row) => row.laborCost === null && row.profitAfterWages === null));

    const cashFlow = await server.requestJson("/api/finances/reports/cash-flow", { token: admin.token });
    assert.equal(cashFlow.data.operatingActivities.payrollCashOutflow, null);

    const plan = await server.requestJson("/api/finances/expense-budgets/labor-plan", { token: admin.token });
    assert.equal(plan.status, 403);
  });
});
