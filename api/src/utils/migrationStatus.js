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
