import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "../api/node_modules/bcryptjs/index.js";
import pool from "../api/src/database.js";
import { pinLockoutMinutes } from "../api/src/routes/finances.js";
import { createCleanupTracker, startTestServer } from "./helpers/testServer.js";

const PIN_COLUMNS = `owner_net_income_pin_hash, owner_net_income_pin_failed_attempts,
  owner_net_income_pin_lockouts, owner_net_income_pin_locked_until`;

describe("Net Income PIN: escalating lockout and 6-digit new PINs (F6)", () => {
  let server;
  let saved;
  const tracker = createCleanupTracker();

  before(async () => {
    server = await startTestServer();
    [[saved]] = await pool.execute(`SELECT ${PIN_COLUMNS} FROM business_settings WHERE id = 1`);
  });

  after(async () => {
    try {
      await pool.execute(
        `UPDATE business_settings SET owner_net_income_pin_hash = ?, owner_net_income_pin_failed_attempts = ?,
            owner_net_income_pin_lockouts = ?, owner_net_income_pin_locked_until = ? WHERE id = 1`,
        [saved.owner_net_income_pin_hash, saved.owner_net_income_pin_failed_attempts, saved.owner_net_income_pin_lockouts, saved.owner_net_income_pin_locked_until],
      );
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  it("uses 5 minutes, then 1 hour, then 24 hours", () => {
    assert.equal(pinLockoutMinutes(1), 5);
    assert.equal(pinLockoutMinutes(2), 60);
    assert.equal(pinLockoutMinutes(3), 1440);
    assert.equal(pinLockoutMinutes(9), 1440);
  });

  it("makes each consecutive lockout longer and resets after a correct PIN", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const pin = "246813";
    await pool.execute(
      `UPDATE business_settings SET owner_net_income_pin_hash = ?, owner_net_income_pin_failed_attempts = 0,
          owner_net_income_pin_lockouts = 0, owner_net_income_pin_locked_until = NULL WHERE id = 1`,
      [await bcrypt.hash(pin, 4)],
    );
    const verify = (value) => server.requestJson("/api/finances/net-income-pin/verify", {
      method: "POST",
      token: admin.token,
      body: { pin: value },
    });
    const failFiveTimes = async () => {
      let last;
      for (let i = 0; i < 5; i += 1) last = await verify("000000");
      return last;
    };
    const expireLock = () => pool.execute(
      "UPDATE business_settings SET owner_net_income_pin_locked_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE id = 1",
    );

    const first = await failFiveTimes();
    assert.equal(first.status, 429);
    assert.match(first.data.message, /5 minutes/);

    const whileLocked = await verify(pin);
    assert.equal(whileLocked.status, 429, "the correct PIN must not work during a lockout");

    await expireLock();
    const second = await failFiveTimes();
    assert.equal(second.status, 429);
    assert.match(second.data.message, /1 hour/);

    await expireLock();
    const third = await failFiveTimes();
    assert.equal(third.status, 429);
    assert.match(third.data.message, /24 hours/);

    await expireLock();
    const unlocked = await verify(pin);
    assert.equal(unlocked.status, 200);
    const [[row]] = await pool.execute("SELECT owner_net_income_pin_lockouts AS lockouts FROM business_settings WHERE id = 1");
    assert.equal(Number(row.lockouts), 0, "a correct PIN resets the lockout count");
  });

  it("requires 6 digits for a new PIN", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    await pool.execute(
      `UPDATE business_settings SET owner_net_income_pin_hash = ?, owner_net_income_pin_failed_attempts = 0,
          owner_net_income_pin_lockouts = 0, owner_net_income_pin_locked_until = NULL WHERE id = 1`,
      [await bcrypt.hash("1357", 4)],
    );
    const set = (newPin) => server.requestJson("/api/finances/net-income-pin/set", {
      method: "POST",
      token: admin.token,
      body: { pin: newPin, currentPin: "1357" },
    });
    assert.equal((await set("9753")).status, 400, "a 4-digit new PIN is rejected");
    assert.equal((await set("975310")).status, 200, "a 6-digit new PIN is accepted (old 4-digit PIN still unlocks)");
  });
});
