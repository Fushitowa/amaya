import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

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
const migrations = [
  "001_initial_schema.sql",
  "002_expand_product_images_and_seed_menu.sql",
  "003_order_inventory_consumptions.sql",
  "004_inventory_tracked_addons.sql",
  "005_persistent_notifications.sql",
  "006_inventory_inactivity_alerts.sql",
  "007_recipe_unit_conversions.sql",
  "008_size_specific_recipes.sql",
  "009_replace_minimum_with_maximum_stock.sql",
  "010_archive_inventory_items.sql",
  "011_inventory_unit_precision.sql",
  "009_archive_and_audit_logs.sql",
  "010_inventory_pricing_and_costing.sql",
  "012_repair_archive_schema.sql",
  "013_cost_snapshots_and_unit_cost_precision.sql",
  "014_cups_category_and_table.sql",
  "015_user_token_version.sql",
  "016_seed_9_menu_categories.sql",
  "017_seed_23_store_products_and_ingredients.sql",
  "018_seed_full_recipes_and_packaging_from_docx.sql",
  "019_inventory_categories_and_operational_families.sql",
  "020_dynamic_inventory_categories_and_reset_readiness.sql",
  "021_cashier_management_and_order_attribution.sql",
  "022_repair_operational_family.sql",
  "023_repair_login_display_name.sql",
  "024_repair_inventory_categories.sql",
  "025_migration_sync_and_drift_reconciliation.sql",
  "026_order_audit_void_and_addon_cogs.sql",
  "027_structured_inventory_movements.sql",
  "028_cashier_sessions.sql",
  "029_business_settings_target_food_cost_check.sql",
  "030_double_entry_financial_management_system.sql",
  "031_financial_ledger_integrity.sql",
  "032_expand_business_settings.sql",
  "033_allow_partial_reversals.sql",
  "034_inventory_waste_logging_metadata.sql",
  "035_waste_measurement_precision_and_scoping.sql",
  "036_income_statement_classification_and_accounts.sql",
  "037_income_statement_phase2_missing_items.sql",
  "038_cashier_sales_owner_confirmation.sql",
  "039_reset_orders_owner_confirmation_for_live_gate.sql",
  "040_phase2_hardening.sql",
  "041_schema_hygiene_indexes_fks.sql",
  "042_restock_velocity_index.sql",
  "043_expense_budgets.sql",
];

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



