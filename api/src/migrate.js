import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { MIGRATIONS } from "./migrationList.js";

/**
 * Sequential SQL migration runner for Amaya POS.
 * - Executes against the configured DB_NAME connection (SQL files do not hardcode USE amaya;).
 * - Acquires MySQL advisory lock 'amaya_migrations' so concurrent runners never race.
 * - Duplicate/superseded file notes (preserved for schema_migrations compatibility):
 *     * 002_expand_images_and_seed_menu.sql was superseded by 002_expand_product_images_and_seed_menu.sql.
 *     * 021_inventory_item_image.sql is excluded from this list; its column is reconciled by 025.
 *     * Duplicate 009_* and 010_* prefixes keep their historical applied order in schema_migrations.
 *     * Legacy 009/010/015 non-idempotent DDL runs once per DB and is reconciled by 012/025.
 * - Destructive one-time reset migrations (DESTRUCTIVE_RESET_MIGRATIONS) are guarded against
 *   non-empty confirmed data unless --allow-destructive or ALLOW_DESTRUCTIVE_MIGRATIONS=1 is set.
 */
const migrations = MIGRATIONS;

// Never add unguarded bulk UPDATE/DELETE reset migrations; register historical resets here.
const DESTRUCTIVE_RESET_MIGRATIONS = new Set([
  "039_reset_orders_owner_confirmation_for_live_gate.sql",
]);
const allowDestructive =
  process.argv.includes("--allow-destructive") ||
  process.env.ALLOW_DESTRUCTIVE_MIGRATIONS === "1";

const dbUser = process.env.DB_USER || "root";
const dbPassword = process.env.DB_PASSWORD || "";

if (process.env.NODE_ENV === "production" && (dbUser === "root" || !dbPassword)) {
  throw new Error(
    "Refusing to connect in production with root or empty DB_PASSWORD. Configure a dedicated least-privilege DB_USER and DB_PASSWORD.",
  );
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: dbUser,
  password: dbPassword,
  database: process.env.DB_NAME || "amaya",
  timezone: "+08:00",
  multipleStatements: true,
});

let lockAcquired = false;
try {
  const [[lockRow]] = await connection.query("SELECT GET_LOCK('amaya_migrations', 30) AS acquired");
  if (Number(lockRow?.acquired) !== 1) {
    throw new Error("Could not acquire MySQL advisory lock 'amaya_migrations' within 30 seconds.");
  }
  lockAcquired = true;

  await connection.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version VARCHAR(120) NOT NULL PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  for (const version of migrations) {
    const [[recorded]] = await connection.execute("SELECT version FROM schema_migrations WHERE version = ?", [version]);
    if (recorded) continue;

    if (DESTRUCTIVE_RESET_MIGRATIONS.has(version) && !allowDestructive) {
      const [[liveConfirmed]] = await connection.query(
        `SELECT COUNT(*) AS cnt
           FROM orders
          WHERE payment_status = 'Paid'
            AND order_status <> 'Cancelled'
            AND owner_confirmed_at IS NOT NULL
            AND owner_confirmation_note IS NULL`,
      );
      if (Number(liveConfirmed?.cnt || 0) > 0) {
        throw new Error(
          `Refusing to run destructive reset migration '${version}' against ${liveConfirmed.cnt} confirmed order(s) without --allow-destructive or ALLOW_DESTRUCTIVE_MIGRATIONS=1.`,
        );
      }
    }

    const migrationPath = fileURLToPath(new URL(`../../database/migrations/${version}`, import.meta.url));
    const sqlText = (await readFile(migrationPath, "utf8")).replaceAll("utf8mb4_0900_ai_ci", "utf8mb4_unicode_ci");
    await connection.query(sqlText);
    await connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
    console.log(`Applied ${version}`);
  }
  console.log("Database migrations are current. Menu categories are ready; add products in Admin Portal.");
} finally {
  if (lockAcquired) {
    try {
      await connection.query("SELECT RELEASE_LOCK('amaya_migrations')");
    } catch {
      // Preserve any migration error and ensure connection.end() executes
    }
  }
  await connection.end();
}



