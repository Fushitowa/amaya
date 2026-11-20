import "./helpers/loadEnv.js";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { runArchivePurgeCheck } from "../api/src/routes/archive.js";
import { makeUniqueTag } from "./helpers/testServer.js";

// Archived ingredients with stock or order history can never be deleted, so the purge job
// used to retry them every 60 s forever and log a warning each time (audit finding F15).
describe("Archive auto-purge skips items that must keep their history", () => {
  const createdIds = [];

  after(async () => {
    try {
      if (createdIds.length) {
        const marks = createdIds.map(() => "?").join(",");
        await pool.execute(`DELETE FROM inventory_movements WHERE inventory_item_id IN (${marks})`, createdIds);
        await pool.execute(`DELETE FROM inventory_items WHERE id IN (${marks})`, createdIds);
      }
    } finally {
      await pool.end();
    }
  });

  it("purges an expired item without history and quietly keeps one with stock history", async () => {
    const tag = makeUniqueTag("Purge");
    const insertArchived = async (name) => {
      const [res] = await pool.execute(
        `INSERT INTO inventory_items (name, unit, quantity, is_archived, archived_at)
         VALUES (?, 'g', 0, TRUE, DATE_SUB(NOW(), INTERVAL 400 DAY))`,
        [name],
      );
      createdIds.push(Number(res.insertId));
      return Number(res.insertId);
    };
    const withHistory = await insertArchived(`Purge_History_${tag}`);
    const withoutHistory = await insertArchived(`Purge_Clean_${tag}`);
    await pool.execute(
      "INSERT INTO inventory_movements (inventory_item_id, movement_type, quantity_change, note) VALUES (?, 'adjustment', 0, 'purge test history')",
      [withHistory],
    );

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      await runArchivePurgeCheck();
    } finally {
      console.warn = originalWarn;
    }

    const [[kept]] = await pool.execute("SELECT COUNT(*) AS n FROM inventory_items WHERE id = ?", [withHistory]);
    const [[purged]] = await pool.execute("SELECT COUNT(*) AS n FROM inventory_items WHERE id = ?", [withoutHistory]);
    assert.equal(Number(kept.n), 1, "an item with stock history must be kept");
    assert.equal(Number(purged.n), 0, "an expired item without history must still be purged");
    assert.equal(
      warnings.filter((line) => line.includes(`Purge_History_${tag}`)).length,
      0,
      "the kept item must not produce a warning every minute",
    );
  });
});
