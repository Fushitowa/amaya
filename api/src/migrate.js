import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const migrations = [
  "001_initial_schema.sql",
  "002_expand_product_images_and_seed_menu.sql",
  "003_order_inventory_consumptions.sql",
  "004_inventory_tracked_addons.sql",
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
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  );
  for (const version of migrations) {
    const [[recorded]] = await connection.execute("SELECT version FROM schema_migrations WHERE version = ?", [version]);
    if (recorded) continue;
    const migrationPath = fileURLToPath(new URL(`../../database/migrations/${version}`, import.meta.url));
    await connection.query(await readFile(migrationPath, "utf8"));
    await connection.execute("INSERT INTO schema_migrations (version) VALUES (?)", [version]);
    console.log(`Applied ${version}`);
  }
  console.log("Database migrations are current. Menu categories are ready; add products in Admin Portal.");
} finally {
  await connection.end();
}
