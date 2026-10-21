import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

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
];
const connection = await mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "amaya",
  multipleStatements: true,
});

try {
  await connection.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version VARCHAR(120) NOT NULL PRIMARY KEY,
       applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
  for (const version of migrations) {
    const [[recorded]] = await connection.execute("SELECT version FROM schema_migrations WHERE version = ?", [version]);
    if (recorded) continue;
    const migrationPath = fileURLToPath(new URL(`../../database/migrations/${version}`, import.meta.url));
    const sqlText = (await readFile(migrationPath, "utf8")).replaceAll("utf8mb4_0900_ai_ci", "utf8mb4_unicode_ci");
    await connection.query(sqlText);
    await connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
    console.log(`Applied ${version}`);
  }
  console.log("Database migrations are current. Menu categories are ready; add products in Admin Portal.");
} finally {
  await connection.end();
}
