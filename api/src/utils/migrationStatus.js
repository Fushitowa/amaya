import { MIGRATIONS } from "../migrationList.js";

/**
 * Migrations the code expects that the database has not recorded yet.
 * A non-empty result means features built on those migrations will fail with 500s
 * until `npm run db:migrate` (or the control panel's Setup / Migrate) is run.
 */
export async function findPendingMigrations(executor) {
  const [rows] = await executor.query("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.version));
  return MIGRATIONS.filter((version) => !applied.has(version));
}

// MySQL/MariaDB errors raised when code reads a column or table a pending migration would add.
const SCHEMA_BEHIND_ERRNOS = new Set([1054, 1146]); // ER_BAD_FIELD_ERROR, ER_NO_SUCH_TABLE

export const DB_UPDATE_REQUIRED_MESSAGE =
  "The database needs an update before this works. In the control panel, press 'Update the database' (it backs up first).";

/** True when `error` means the database schema is older than the code. */
export function isSchemaBehindError(error) {
  return Boolean(error) && SCHEMA_BEHIND_ERRNOS.has(Number(error.errno));
}
