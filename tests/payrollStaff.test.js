import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createNetIncomeAccessToken } from "../api/src/routes/finances.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

describe("Payroll staff list (payroll plan P1.5–P1.7)", () => {
  let server;
  const tracker = createCleanupTracker();
  const employeeIds = [];

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    try {
      if (employeeIds.length) {
        const marks = employeeIds.map(() => "?").join(",");
        await pool.execute(`DELETE FROM employee_pay_rates WHERE employee_id IN (${marks})`, employeeIds);
        await pool.execute(`DELETE FROM employees WHERE id IN (${marks})`, employeeIds);
      }
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  const pinHeaders = (user) => ({ "X-Net-Income-Token": createNetIncomeAccessToken(user.id) });

  async function addEmployee(admin, overrides = {}) {
    const res = await server.requestJson("/api/payroll/employees", {
      method: "POST",
      token: admin.token,
      body: {
        fullName: makeUniqueTag("Crew"),
        position: "Barista",
        employmentStatus: "regular",
        payBasis: "daily",
        dailyDivisor: 313,
        startDate: "2026-01-05",
        rate: 645,
        ...overrides,
      },
    });
    if (res.data?.employee?.id) employeeIds.push(res.data.employee.id);
    return res;
  }

  it("is owner/admin only", async () => {
    const staff = await tracker.createUser({ role: "staff" });
    const list = await server.requestJson("/api/payroll/employees", { token: staff.token });
    assert.equal(list.status, 403);
    const add = await server.requestJson("/api/payroll/employees", { method: "POST", token: staff.token, body: { fullName: "X" } });
    assert.equal(add.status, 403);
    const anonymous = await server.requestJson("/api/payroll/employees");
    assert.equal(anonymous.status, 401);
  });

  it("stores government IDs encrypted and only returns the last 4 digits", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const res = await addEmployee(admin, { governmentIds: { sss: "34-1234567-8", tin: "123-456-789" } });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    const { employee } = res.data;
    assert.equal(employee.governmentIds.sss, "•••• 5678");
    assert.equal(employee.governmentIds.tin, "•••• 6789");
    assert.equal(employee.governmentIds.philhealth, null);
    assert.ok(!JSON.stringify(res.data).includes("1234567"), "full number never leaves the API");

    const [[row]] = await pool.execute("SELECT sss_no, tin FROM employees WHERE id = ?", [employee.id]);
    assert.match(row.sss_no, /^v1:/);
    assert.ok(!row.sss_no.includes("341234567"), "stored as ciphertext, not plain text");

    const cleared = await server.requestJson(`/api/payroll/employees/${employee.id}`, {
      method: "PATCH",
      token: admin.token,
      body: { governmentIds: { tin: "" } },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.data.employee.governmentIds.tin, null);
    assert.equal(cleared.data.employee.governmentIds.sss, "•••• 5678", "untouched IDs stay");

    const bad = await addEmployee(admin, { governmentIds: { philhealth: "123" } });
    assert.equal(bad.status, 400);
  });

  it("hides pay rates unless the Net Income PIN is unlocked", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const res = await addEmployee(admin);
    const id = res.data.employee.id;

    const locked = await server.requestJson(`/api/payroll/employees/${id}`, { token: admin.token });
    assert.equal(locked.status, 200);
    assert.equal(locked.data.employee.ratesLocked, true);
    assert.equal(locked.data.employee.currentRate, null);
    assert.equal(locked.data.employee.rateHistory, null);

    const list = await server.requestJson("/api/payroll/employees", { token: admin.token });
    assert.ok(list.data.items.every((item) => item.currentRate === null));

    const unlocked = await server.requestJson(`/api/payroll/employees/${id}`, { token: admin.token, headers: pinHeaders(admin) });
    assert.equal(unlocked.data.employee.currentRate, 645);
    assert.equal(unlocked.data.employee.rateHistory.length, 1);
  });

  it("keeps rate history: a change adds a row and never edits the old one", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const id = (await addEmployee(admin)).data.employee.id;

    const viaPatch = await server.requestJson(`/api/payroll/employees/${id}`, { method: "PATCH", token: admin.token, body: { rate: 700 } });
    assert.equal(viaPatch.status, 400, "rate cannot be overwritten through edit");

    const raise = await server.requestJson(`/api/payroll/employees/${id}/rates`, {
      method: "POST",
      token: admin.token,
      headers: pinHeaders(admin),
      body: { rate: 700, effectiveFrom: "2026-06-01", note: "Regularization" },
    });
    assert.equal(raise.status, 201, JSON.stringify(raise.data));
    const history = raise.data.employee.rateHistory;
    assert.deepEqual(history.map((row) => [row.rate, row.effectiveFrom]), [[700, "2026-06-01"], [645, "2026-01-05"]]);

    const early = await server.requestJson(`/api/payroll/employees/${id}/rates`, {
      method: "POST",
      token: admin.token,
      body: { rate: 500, effectiveFrom: "2025-12-01" },
    });
    assert.equal(early.status, 400, "a rate cannot start before the start date");

    const toMonthly = await server.requestJson(`/api/payroll/employees/${id}/rates`, {
      method: "POST",
      token: admin.token,
      headers: pinHeaders(admin),
      body: { rate: 18000, payBasis: "monthly", effectiveFrom: "2026-07-01" },
    });
    assert.equal(toMonthly.status, 201, JSON.stringify(toMonthly.data));
    assert.equal(toMonthly.data.employee.payBasis, "monthly");

    const [[count]] = await pool.execute("SELECT COUNT(*) AS n FROM employee_pay_rates WHERE employee_id = ?", [id]);
    assert.equal(Number(count.n), 3);
  });

  it("links only staff logins, one employee per login, never the owner", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    const owner = await addEmployee(admin, { userId: Number(admin.id) });
    assert.equal(owner.status, 400);
    assert.match(owner.data.message, /Owner's Drawings/);

    const first = await addEmployee(admin, { userId: Number(staff.id) });
    assert.equal(first.status, 201, JSON.stringify(first.data));
    assert.equal(first.data.employee.linkedUser.id, Number(staff.id));

    const second = await addEmployee(admin, { userId: Number(staff.id) });
    assert.equal(second.status, 409);

    const linkable = await server.requestJson("/api/payroll/linkable-users", { token: admin.token });
    assert.ok(!linkable.data.items.some((user) => user.id === Number(staff.id)), "an already-linked login is not offered again");
  });

  it("resigns, archives (unlinking the login) and reactivates", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });
    const id = (await addEmployee(admin, { userId: Number(staff.id) })).data.employee.id;

    const tooEarly = await server.requestJson(`/api/payroll/employees/${id}/archive`, { method: "POST", token: admin.token, body: {} });
    assert.equal(tooEarly.status, 400, "must resign before archiving");

    const beforeStart = await server.requestJson(`/api/payroll/employees/${id}/resign`, { method: "POST", token: admin.token, body: { endDate: "2025-01-01" } });
    assert.equal(beforeStart.status, 400);

    const resigned = await server.requestJson(`/api/payroll/employees/${id}/resign`, { method: "POST", token: admin.token, body: { endDate: "2026-10-31" } });
    assert.equal(resigned.status, 200);
    assert.equal(resigned.data.employee.status, "resigned");
    assert.equal(resigned.data.employee.endDate, "2026-10-31");

    const archived = await server.requestJson(`/api/payroll/employees/${id}/archive`, { method: "POST", token: admin.token, body: {} });
    assert.equal(archived.status, 200);
    assert.equal(archived.data.employee.isArchived, true);
    assert.equal(archived.data.employee.linkedUser, null, "archiving frees the POS login");

    const activeList = await server.requestJson("/api/payroll/employees?status=all", { token: admin.token });
    assert.ok(!activeList.data.items.some((item) => item.id === id), "archived employees are hidden by default");

    const back = await server.requestJson(`/api/payroll/employees/${id}/reactivate`, { method: "POST", token: admin.token, body: {} });
    assert.equal(back.status, 200);
    assert.equal(back.data.employee.status, "active");
    assert.equal(back.data.employee.endDate, null);
    assert.equal(back.data.employee.isArchived, false);
  });
});
