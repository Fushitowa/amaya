import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { postBalancedEntry } from "../api/src/utils/ledgerService.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";
import {
  EXPENSE_NAV_CATEGORIES,
  EXPENSE_NAV_TREE,
  LEGACY_ACCOUNT_OWNER,
  getExpenseCategoryScope,
} from "../shared/expenseNavigation.js";

const round2 = (value) => Math.round(value * 100) / 100;

describe("Expense budgets count every record once (payroll plan P1.3/P1.4)", () => {
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

  it("gives Salary, Wages, Overtime, Government Contributions and 13th Month their own accounts", () => {
    const codeOf = (slug) => EXPENSE_NAV_CATEGORIES.find((category) => category.slug === slug).accountCodes;
    assert.deepEqual(codeOf("salary"), ["6111"]);
    assert.deepEqual(codeOf("wages"), ["6115"]);
    assert.deepEqual(codeOf("overtime"), ["6116"]);
    assert.deepEqual(codeOf("government-contributions"), ["6112"]);
    assert.deepEqual(codeOf("thirteenth-month"), ["6114"]);
    const labor = EXPENSE_NAV_TREE.find((node) => node.slug === "labor-and-payroll");
    assert.deepEqual(labor.children, ["salary", "wages", "overtime", "government-contributions", "thirteenth-month", "staff-meals"]);
  });

  it("assigns every untagged legacy account to exactly one category", () => {
    const allCodes = new Set(EXPENSE_NAV_CATEGORIES.flatMap((category) => category.accountCodes));
    for (const code of allCodes) assert.ok(LEGACY_ACCOUNT_OWNER[code], `${code} has an owner`);
    assert.equal(LEGACY_ACCOUNT_OWNER["6111"], "salary");
    assert.equal(LEGACY_ACCOUNT_OWNER["6160"], "maintenance-expenses", "shared 6160 goes to the first leaf only");
    assert.deepEqual(getExpenseCategoryScope("labor-for-repairs").legacyAccountCodes, []);
    // Sibling leaves never share a legacy account.
    for (const node of EXPENSE_NAV_TREE) {
      const seen = new Set();
      for (const child of node.children) {
        for (const code of getExpenseCategoryScope(child).legacyAccountCodes) {
          assert.ok(!seen.has(code), `${code} counted twice under ${node.slug}`);
          seen.add(code);
        }
      }
    }
  });

  it("counts each payroll child once and makes the group equal the sum of its children", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const health = async () => {
      const res = await server.requestJson("/api/finances/expense-budgets/health", { token: admin.token });
      assert.equal(res.status, 200);
      return Object.fromEntries(res.data.items.map((item) => [item.category, item.spent]));
    };
    // Payroll accounts are closed to manual entry, so these records go straight to the ledger,
    // as older (pre-payroll) records would have.
    const post = async (accountCode, amount, categorySlug = null) => {
      const connection = await pool.getConnection();
      try {
        const { entryId } = await postBalancedEntry(connection, {
          entryType: "operating_expense",
          memo: `${makeUniqueTag("Budget")} ${categorySlug || "untagged"} ${accountCode}`,
          createdBy: admin.id,
          lines: [
            { accountCode, debit: amount, credit: 0 },
            { accountCode: "1030", debit: 0, credit: amount },
          ],
        });
        if (categorySlug) {
          await connection.execute(
            "UPDATE journal_entries je JOIN expense_categories ec ON ec.slug = ? SET je.expense_category_id = ec.id WHERE je.id = ?",
            [categorySlug, entryId],
          );
        }
      } finally {
        connection.release();
      }
    };
    const record = (category, amount) => post({ salary: "6111", wages: "6115", overtime: "6116" }[category], amount, category);
    const legacy = (accountCode, amount) => post(accountCode, amount);

    const before = await health();
    await legacy("6111", 100); // an older payroll expense with no category tag
    await record("salary", 20);
    await record("wages", 50);
    await record("overtime", 30);
    await legacy("6160", 40); // older repairs record on the shared 6160 account
    const after = await health();
    const delta = (slug) => round2((after[slug] || 0) - (before[slug] || 0));

    assert.equal(delta("salary"), 120, "untagged 6111 counts under Salary once");
    assert.equal(delta("wages"), 50, "wages no longer picks up 6111");
    assert.equal(delta("overtime"), 30, "overtime no longer picks up 6111");
    assert.equal(delta("labor-and-payroll"), 200, "group = sum of children, nothing doubled");
    assert.equal(delta("maintenance-expenses"), 40);
    assert.equal(delta("labor-for-repairs"), 0, "shared 6160 is not counted on the sibling page");
    assert.equal(delta("repairs-and-maintenance"), 40);

    for (const node of EXPENSE_NAV_TREE.filter((n) => n.children.length)) {
      const childSum = round2(node.children.reduce((sum, slug) => sum + (after[slug] || 0), 0));
      assert.ok(after[node.slug] >= childSum - 0.001, `${node.slug} includes all of its children`);
    }
  });

  it("shows an untagged shared-account record on one category page only", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    const memo = `${makeUniqueTag("Legacy")} untagged 6160 page`;
    const posted = await server.requestJson("/api/finances/journal-entries", {
      method: "POST",
      token: admin.token,
      body: { entryType: "operating_expense", amount: 15, debitAccountCode: "6160", creditAccountCode: "1030", memo },
    });
    assert.equal(posted.status, 201, JSON.stringify(posted.data));
    const list = async (slug) => {
      const res = await server.requestJson(`/api/finances/journal-entries?type=operating_expense&expenseCategory=${slug}&limit=100`, { token: admin.token });
      assert.equal(res.status, 200, JSON.stringify(res.data));
      const rows = res.data.entries || res.data.items || res.data.data || [];
      return rows.some((row) => String(row.memo || row.description || "").includes(memo));
    };
    assert.equal(await list("maintenance-expenses"), true);
    assert.equal(await list("labor-for-repairs"), false);
    assert.equal(await list("repairs-and-maintenance"), true);
  });

  it("refuses manual payroll expenses: they go through Payroll Runs", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    for (const category of ["salary", "wages", "overtime", "government-contributions", "thirteenth-month", "labor-and-payroll"]) {
      const res = await server.requestJson("/api/finances/expense-records", {
        method: "POST",
        token: admin.token,
        body: { category, description: "Should be refused", amount: 10, channel: "store_bank" },
      });
      assert.equal(res.status, 400, `${category} must be refused`);
      assert.match(res.data.message, /Payroll Runs/);
    }
    for (const code of ["6111", "6112", "6114", "6115", "6116"]) {
      const res = await server.requestJson("/api/finances/journal-entries", {
        method: "POST",
        token: admin.token,
        body: { entryType: "operating_expense", amount: 10, debitAccountCode: code, creditAccountCode: "1030", memo: "Should be refused" },
      });
      assert.equal(res.status, 400, `${code} must be refused`);
    }
    const meals = await server.requestJson("/api/finances/expense-records", {
      method: "POST",
      token: admin.token,
      body: { category: "staff-meals", description: `${makeUniqueTag("Meals")} staff lunch`, amount: 10, channel: "store_bank" },
    });
    assert.equal(meals.status, 201, "staff meals stay a normal expense");
  });

  it("refuses manual journal entries on the payroll payables", async () => {
    const admin = await tracker.createUser({ role: "admin" });
    for (const code of ["2040", "2045", "2050", "2060"]) {
      const res = await server.requestJson("/api/finances/journal-entries", {
        method: "POST",
        token: admin.token,
        body: { entryType: "adjustment", amount: 10, debitAccountCode: "1030", creditAccountCode: code, memo: "Should be refused" },
      });
      assert.equal(res.status, 400, `${code} must be refused`);
      assert.match(res.data.message, /Payroll Runs/);
    }
  });
});
