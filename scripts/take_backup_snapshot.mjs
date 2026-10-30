import pool from "../api/src/database.js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const BACKUPS_DIR = path.join(ROOT_DIR, "database", "backups");

const SNAPSHOT_TABLES = [
  "menu_categories",
  "menu_products",
  "product_sizes",
  "product_addons",
  "product_ingredients",
  "product_size_ingredients",
  "inventory_categories",
  "inventory_items",
  "inventory_cups",
  "inventory_movements",
  "inventory_alert_states",
  "inventory_inactivity_states",
  "orders",
  "order_items",
  "order_item_addons",
  "order_inventory_consumptions",
];

async function backup() {
  await mkdir(BACKUPS_DIR, { recursive: true });
  const connection = await pool.getConnection();
  try {
    const tables = {};
    for (const table of SNAPSHOT_TABLES) {
      try {
        const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
        tables[table] = rows;
      } catch (err) {
        tables[table] = [];
      }
    }
    const snapshot = {
      version: "1.0",
      tag: "pre_menu_cup_logic_fix_step1",
      createdAt: new Date().toISOString(),
      counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
      tables,
    };
    const backupPath = path.join(BACKUPS_DIR, "catalog_vault_pre_cup_fix_20261030.json");
    await writeFile(backupPath, JSON.stringify(snapshot, null, 2), "utf8");
    console.log(`[Backup Success] Live snapshot saved non-destructively to: ${backupPath}`);
    console.log("Counts:", snapshot.counts);
  } finally {
    connection.release();
    await pool.end();
  }
}

backup().catch((e) => {
  console.error(e);
  process.exit(1);
});
