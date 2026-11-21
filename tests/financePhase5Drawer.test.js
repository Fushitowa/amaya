import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { DRAWER_DEFAULTS, drawerVarianceStatus, isDrawerPattern, normalizeDrawerThresholds, validateDrawerThresholds } from "../shared/drawerThresholds.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

describe("Drawer limits (shared rules)", () => {
  it("grades shifts against the limits, short or over alike", () => {
    const limits = { ok: 50, review: 200 };
    assert.equal(drawerVarianceStatus(null, limits), null);
    assert.equal(drawerVarianceStatus(-50, limits).key, "ok");
    assert.equal(drawerVarianceStatus(75, limits).key, "review");
    assert.equal(drawerVarianceStatus(-200.01, limits).key, "investigate");
    assert.equal(drawerVarianceStatus(30, { ok: 10, review: 20 }).key, "investigate", "custom limits apply");
    assert.equal(drawerVarianceStatus(0).key, "ok", "defaults apply when no limits are given");
  });

  it("falls back to the defaults for bad stored values and rejects bad input", () => {
    assert.deepEqual(normalizeDrawerThresholds(null, null), DRAWER_DEFAULTS);
    assert.deepEqual(normalizeDrawerThresholds(100, 50), DRAWER_DEFAULTS);
    assert.deepEqual(normalizeDrawerThresholds("30", "90"), { ok: 30, review: 90 });
    assert.ok(validateDrawerThresholds(-1, 5).error);
    assert.ok(validateDrawerThresholds(10, 5).error);
    assert.ok(validateDrawerThresholds("abc", 5).error);
    assert.ok(validateDrawerThresholds(true, 5).error);
    assert.ok(validateDrawerThresholds(0, 1_000_000).error);
    assert.deepEqual(validateDrawerThresholds(0, 0), { ok: 0, review: 0 });
  });

  it("calls it a pattern only after repeated flagged shifts on the same weekday", () => {
    assert.equal(isDrawerPattern(2, 2), false);
    assert.equal(isDrawerPattern(3, 1), false);
    assert.equal(isDrawerPattern(3, 2), true);
    assert.equal(isDrawerPattern(8, 5), true);
  });
});

describe("Drawer limits and history (API)", () => {
  let openServer;
  let lockedServer;
  let admin;
  const tracker = createCleanupTracker();
  const sessionIds = [];

  before(async () => {
    openServer = await startTestServer({ unlockNetIncome: true });
    lockedServer = await startTestServer();
    admin = await tracker.createUser({ role: "admin", username: makeUniqueTag("p5_drawer").toLowerCase() });
    await pool.query("UPDATE business_settings SET drawer_variance_ok = 50, drawer_variance_review = 200 WHERE id = 1");
  });

  after(async () => {
    try {
      if (sessionIds.length) {
        await pool.query(`DELETE FROM cashier_sessions WHERE id IN (${sessionIds.map(() => "?").join(",")})`, sessionIds);
      }
      await pool.query("UPDATE business_settings SET drawer_variance_ok = 50, drawer_variance_review = 200 WHERE id = 1");
      await tracker.cleanup();
    } finally {
      await openServer?.close();
      await lockedServer?.close();
      await pool.end();
    }
  });

  it("reads the limits, and changing them needs the PIN and sensible numbers", async () => {
    const read = await openServer.requestJson("/api/finances/drawer-thresholds", { token: admin.token });
    assert.equal(read.status, 200);
    assert.deepEqual(read.data, { ok: 50, review: 200 });

    const locked = await lockedServer.requestJson("/api/finances/drawer-thresholds", { method: "PUT", token: admin.token, body: { ok: 10, review: 20 } });
    assert.equal(locked.status, 403);
    const backwards = await openServer.requestJson("/api/finances/drawer-thresholds", { method: "PUT", token: admin.token, body: { ok: 100, review: 20 } });
    assert.equal(backwards.status, 400);
    const text = await openServer.requestJson("/api/finances/drawer-thresholds", { method: "PUT", token: admin.token, body: { ok: "lots", review: 20 } });
    assert.equal(text.status, 400);

    const saved = await openServer.requestJson("/api/finances/drawer-thresholds", { method: "PUT", token: admin.token, body: { ok: 20, review: 80 } });
    assert.equal(saved.status, 200);
    const again = await openServer.requestJson("/api/finances/drawer-thresholds", { token: admin.token });
    assert.deepEqual(again.data, { ok: 20, review: 80 });
    await openServer.requestJson("/api/finances/drawer-thresholds", { method: "PUT", token: admin.token, body: { ok: 50, review: 200 } });
  });

  it("groups closed shifts by cashier and weekday and flags a repeat problem", async () => {
    const closeDay = (daysAgo) => {
      const d = new Date(Date.now() - daysAgo * 86_400_000);
      return `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d)} 20:00:00`;
    };
    // Three shifts closed on the same weekday (7 days apart): two well outside the normal limit.
    for (const [daysAgo, variance] of [[7, -120], [14, 80], [21, 10]]) {
      const [res] = await pool.execute(
        `INSERT INTO cashier_sessions (user_id, cashier_name_snapshot, opened_at, closed_at, status, opening_float, variance)
         VALUES (?, 'P5 Cashier', ?, ?, 'closed', 500, ?)`,
        [admin.id, closeDay(daysAgo).replace("20:00:00", "09:00:00"), closeDay(daysAgo), variance],
      );
      sessionIds.push(Number(res.insertId));
    }
    // An open shift and a shift without a count must never be counted.
    const [openRes] = await pool.execute(
      "INSERT INTO cashier_sessions (user_id, cashier_name_snapshot, status, opening_float) VALUES (?, 'P5 Cashier', 'open', 500)",
      [admin.id],
    );
    sessionIds.push(Number(openRes.insertId));

    const res = await openServer.requestJson("/api/finances/reports/drawer-history", { token: admin.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data.thresholds, { ok: 50, review: 200 });
    const mine = res.data.items.filter((item) => item.userId === admin.id);
    assert.equal(mine.length, 1, "all three shifts fall on one weekday");
    assert.equal(mine[0].shifts, 3);
    assert.equal(mine[0].flaggedShifts, 2);
    assert.equal(mine[0].netVariance, -30);
    assert.equal(mine[0].averageDifference, 70);
    assert.equal(mine[0].isPattern, true);
    assert.ok(res.data.patternCount >= 1);

    const narrow = await openServer.requestJson(`/api/finances/reports/drawer-history?from=${closeDay(8).slice(0, 10)}`, { token: admin.token });
    const narrowMine = narrow.data.items.filter((item) => item.userId === admin.id);
    assert.equal(narrowMine[0].shifts, 1, "the date filter narrows the shifts counted");
    assert.equal(narrowMine[0].isPattern, false);

    assert.equal((await openServer.requestJson("/api/finances/reports/drawer-history?from=2026-13-01", { token: admin.token })).status, 400);
  });
});
