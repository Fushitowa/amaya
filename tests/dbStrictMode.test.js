import "./helpers/loadEnv.js";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";

// XAMPP MariaDB's default sql_mode is not strict, so bad values used to be silently
// clamped or truncated (audit finding F10). The API pool turns strict mode on per session.
describe("API database sessions run in strict SQL mode", () => {
  after(async () => {
    await pool.end();
  });

  it("enables STRICT_TRANS_TABLES and rejects invalid values instead of storing junk", async () => {
    const [[row]] = await pool.query("SELECT @@SESSION.sql_mode AS mode, @@SESSION.time_zone AS tz");
    assert.match(row.mode, /STRICT_TRANS_TABLES/);
    assert.equal(row.tz, "+08:00");

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await assert.rejects(
        connection.execute("INSERT INTO menu_categories (name, operational_family) VALUES (?, 'not_a_family')", [`Strict_${Date.now()}`]),
        /Data truncated|Incorrect|invalid/i,
      );
    } finally {
      await connection.rollback();
      connection.release();
    }
  });
});
