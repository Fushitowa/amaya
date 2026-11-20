import "./helpers/loadEnv.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MIGRATIONS } from "../api/src/migrationList.js";
import { findPendingMigrations } from "../api/src/utils/migrationStatus.js";

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
