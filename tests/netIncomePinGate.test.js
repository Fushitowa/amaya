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
});
