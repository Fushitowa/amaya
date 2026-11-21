import "./helpers/loadEnv.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MIGRATIONS } from "../api/src/migrationList.js";
import pool from "../api/src/database.js";
import { DB_UPDATE_REQUIRED_MESSAGE, findPendingMigrations, isSchemaBehindError } from "../api/src/utils/migrationStatus.js";

// The live DB once ran three migrations behind the code and features failed with 500s
// (audit finding F1). The API now reports pending migrations at startup and in /api/health.
describe("Pending migration detection (F1b)", () => {
  const fakeDb = (versions) => ({
    query: async () => [versions.map((version) => ({ version }))],
  });

  it("reports nothing when every migration is recorded", async () => {
    assert.deepEqual(await findPendingMigrations(fakeDb(MIGRATIONS)), []);
  });

  it("lists the migrations the database has not recorded, in order", async () => {
    const lastTwo = MIGRATIONS.slice(-2);
    assert.deepEqual(await findPendingMigrations(fakeDb(MIGRATIONS.slice(0, -2))), lastTwo);
  });

  it("lists only real migration files", async () => {
    const fs = await import("node:fs/promises");
    const files = new Set(await fs.readdir(new URL("../database/migrations/", import.meta.url)));
    for (const version of MIGRATIONS) assert.ok(files.has(version), `${version} is missing from database/migrations`);
  });
});

// When it happens again (code newer than the database), the API must say "update the database"
// instead of a generic 500 that sends the owner to Restart, which cannot fix it.
describe("A database older than the code is reported plainly", () => {
  it("recognises the real errors MySQL raises for a missing column or table", async () => {
    try {
      const missingColumn = await pool.query("SELECT column_added_by_a_future_migration FROM business_settings").catch((error) => error);
      assert.equal(isSchemaBehindError(missingColumn), true, `errno ${missingColumn.errno}`);
      const missingTable = await pool.query("SELECT 1 FROM table_added_by_a_future_migration").catch((error) => error);
      assert.equal(isSchemaBehindError(missingTable), true, `errno ${missingTable.errno}`);
      const syntax = await pool.query("SELEC 1").catch((error) => error);
      assert.equal(isSchemaBehindError(syntax), false, "other SQL errors stay ordinary 500s");
    } finally {
      await pool.end();
    }
  });

  it("tells the owner which button fixes it", () => {
    assert.match(DB_UPDATE_REQUIRED_MESSAGE, /Update the database/);
    assert.equal(isSchemaBehindError(null), false);
    assert.equal(isSchemaBehindError(new Error("plain")), false);
  });
});
