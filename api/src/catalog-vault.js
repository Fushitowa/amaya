import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "../..");
const BACKUPS_DIR = path.join(ROOT_DIR, "database", "backups");
const LATEST_BACKUP_PATH = path.join(BACKUPS_DIR, "catalog_vault_latest.json");

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

// Tables to clear during archive-clean (complete zero-state operational reset)
const CLEAN_DELETE_TABLES = [
  "order_inventory_consumptions",
  "order_item_addons",
  "order_items",
  "orders",
  "product_size_ingredients",
  "product_ingredients",
  "product_addons",
  "product_sizes",
  "menu_products",
  "menu_categories",
  "inventory_cups",
  "inventory_alert_states",
  "inventory_inactivity_states",
  "inventory_movements",
  "inventory_items",
  "inventory_categories",
];

// Tables to re-insert during recover after upserting categories
const RECOVER_DATA_TABLES = [
  "inventory_items",
  "inventory_cups",
  "inventory_movements",
  "inventory_alert_states",
  "inventory_inactivity_states",
  "menu_products",
  "product_sizes",
  "product_addons",
  "product_ingredients",
  "product_size_ingredients",
  "orders",
  "order_items",
  "order_item_addons",
  "order_inventory_consumptions",
];

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function formatTimestampForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function normalizeDbValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) {
    return val;
  }
  if (typeof val === "string" && ISO_DATETIME_RE.test(val)) {
    const parsed = new Date(val);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return val;
}

async function ensureArchiveAuditSchema(connection) {
  // Expand archive_audit_logs ENUM columns if needed so 'catalog_vault', 'vault_archived_and_cleaned', 'vault_recovered' work seamlessly
  await connection.query(`
    CREATE TABLE IF NOT EXISTS archive_audit_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      entity_type VARCHAR(64) NOT NULL,
      entity_id BIGINT UNSIGNED NOT NULL,
      entity_name VARCHAR(160) NOT NULL,
      action VARCHAR(64) NOT NULL,
      actor_id BIGINT UNSIGNED NULL,
      actor_name VARCHAR(80) NOT NULL DEFAULT 'System',
      note VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_archive_audit_entity (entity_type, entity_id),
      KEY idx_archive_audit_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  try {
    await connection.query(`
      ALTER TABLE archive_audit_logs
        MODIFY COLUMN entity_type VARCHAR(64) NOT NULL,
        MODIFY COLUMN action VARCHAR(64) NOT NULL
    `);
  } catch {
    // Ignore if already VARCHAR
  }
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0]?.cnt || 0) > 0;
}

async function getValidTableColumns(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT column_name AS col
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName],
  );
  return new Set(rows.map((r) => r.col || r.COLUMN_NAME));
}

async function fetchSnapshotFromDb(connection) {
  const tables = {};
  for (const table of SNAPSHOT_TABLES) {
    if (await tableExists(connection, table)) {
      const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
      tables[table] = rows;
    } else {
      tables[table] = [];
    }
  }
  return {
    version: "1.0",
    createdAt: new Date().toISOString(),
    counts: {
      menuCategories: tables.menu_categories.length,
      menuProducts: tables.menu_products.length,
      productSizes: tables.product_sizes.length,
      productAddons: tables.product_addons.length,
      productIngredients: tables.product_ingredients.length,
      productSizeIngredients: tables.product_size_ingredients.length,
      inventoryCategories: tables.inventory_categories.length,
      inventoryItems: tables.inventory_items.length,
      inventoryCups: tables.inventory_cups.length,
    },
    tables,
  };
}

async function readLatestBackupMetadata() {
  if (!existsSync(LATEST_BACKUP_PATH)) {
    return {
      hasBackup: false,
      backupTimestamp: null,
      backupMenu: 0,
      backupInventory: 0,
      snapshot: null,
    };
  }
  try {
    const raw = await readFile(LATEST_BACKUP_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const backupMenu = parsed?.tables?.menu_products?.length ?? parsed?.counts?.menuProducts ?? 0;
    const backupInventory = parsed?.tables?.inventory_items?.length ?? parsed?.counts?.inventoryItems ?? 0;
    return {
      hasBackup: true,
      backupTimestamp: parsed?.createdAt || null,
      backupMenu,
      backupInventory,
      snapshot: parsed,
    };
  } catch {
    return {
      hasBackup: false,
      backupTimestamp: null,
      backupMenu: 0,
      backupInventory: 0,
      snapshot: null,
    };
  }
}

async function upsertRowsIntoTable(connection, tableName, rows, useDuplicateUpdate = false) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  if (!(await tableExists(connection, tableName))) return 0;

  const validColsSet = await getValidTableColumns(connection, tableName);
  const sampleKeys = Object.keys(rows[0]).filter((k) => validColsSet.has(k));
  if (sampleKeys.length === 0) return 0;

  const quotedCols = sampleKeys.map((col) => `\`${col}\``).join(", ");
  const placeholders = sampleKeys.map(() => "?").join(", ");

  let sql = `INSERT INTO \`${tableName}\` (${quotedCols}) VALUES (${placeholders})`;
  if (useDuplicateUpdate) {
    const updateClause = sampleKeys
      .filter((col) => col !== "id")
      .map((col) => `\`${col}\` = VALUES(\`${col}\`)`)
      .join(", ");
    if (updateClause) {
      sql += ` ON DUPLICATE KEY UPDATE ${updateClause}`;
    } else {
      sql = `INSERT IGNORE INTO \`${tableName}\` (${quotedCols}) VALUES (${placeholders})`;
    }
  }

  let inserted = 0;
  for (const row of rows) {
    const values = sampleKeys.map((col) => normalizeDbValue(row[col]));
    await connection.query(sql, values);
    inserted += 1;
  }
  return inserted;
}

async function runStatus() {
  const connection = await pool.getConnection();
  try {
    const [[menuRow]] = await connection.query("SELECT COUNT(*) AS cnt FROM menu_products");
    const [[invRow]] = await connection.query("SELECT COUNT(*) AS cnt FROM inventory_items");
    const liveMenu = Number(menuRow?.cnt || 0);
    const liveInventory = Number(invRow?.cnt || 0);

    const backupMeta = await readLatestBackupMetadata();
    console.log(
      `[Catalog Vault Status] Live DB: ${liveMenu} Menu Products, ${liveInventory} Inventory Items | ` +
        `Backup: ${
          backupMeta.hasBackup
            ? `${backupMeta.backupMenu} Menu Products, ${backupMeta.backupInventory} Inventory Items (${backupMeta.backupTimestamp})`
            : "None"
        }`,
    );

    const payload = {
      ok: true,
      liveMenu,
      liveInventory,
      hasBackup: backupMeta.hasBackup,
      backupTimestamp: backupMeta.backupTimestamp,
      backupMenu: backupMeta.backupMenu,
      backupInventory: backupMeta.backupInventory,
    };
    console.log(`VAULT_STATUS_JSON:${JSON.stringify(payload)}`);
  } finally {
    connection.release();
  }
}

async function runArchiveAndClean(force = false) {
  await mkdir(BACKUPS_DIR, { recursive: true });
  const connection = await pool.getConnection();

  try {
    const snapshot = await fetchSnapshotFromDb(connection);
    const liveMenuCount = snapshot.tables.menu_products.length;
    const liveInventoryCount = snapshot.tables.inventory_items.length;

    const existingBackup = await readLatestBackupMetadata();

    // Safety guard: do NOT overwrite a non-empty backup with an empty database snapshot!
    if (
      !force &&
      liveMenuCount === 0 &&
      liveInventoryCount === 0 &&
      existingBackup.hasBackup &&
      (existingBackup.backupMenu > 0 || existingBackup.backupInventory > 0)
    ) {
      console.log(
        `[Safety Guard] Live database is already clean (0 Menu Products, 0 Inventory Items). ` +
          `Preserving existing Vault backup from ${existingBackup.backupTimestamp} ` +
          `(${existingBackup.backupMenu} Menu Products, ${existingBackup.backupInventory} Inventory Items).`,
      );
      const payload = {
        ok: true,
        alreadyClean: true,
        liveMenu: 0,
        liveInventory: 0,
        hasBackup: true,
        backupTimestamp: existingBackup.backupTimestamp,
        backupMenu: existingBackup.backupMenu,
        backupInventory: existingBackup.backupInventory,
      };
      console.log(`VAULT_STATUS_JSON:${JSON.stringify(payload)}`);
      return;
    }

    const ts = formatTimestampForFilename();
    const timestampedPath = path.join(BACKUPS_DIR, `catalog_vault_${ts}.json`);
    const serialized = JSON.stringify(snapshot, null, 2);

    await writeFile(LATEST_BACKUP_PATH, serialized, "utf8");
    await writeFile(timestampedPath, serialized, "utf8");

    console.log(
      `[Catalog Vault] Saved snapshot (${liveMenuCount} Menu Products, ${liveInventoryCount} Inventory Items) to:`,
    );
    console.log(`  -> ${LATEST_BACKUP_PATH}`);
    console.log(`  -> ${timestampedPath}`);

    await ensureArchiveAuditSchema(connection);
    await connection.beginTransaction();
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");

      for (const table of CLEAN_DELETE_TABLES) {
        if (await tableExists(connection, table)) {
          await connection.query(`DELETE FROM \`${table}\``);
          try {
            await connection.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`);
          } catch {
            // Ignore if table has no auto-increment column
          }
        }
      }

      const note = `Archived ${liveMenuCount} menu products & ${liveInventoryCount} inventory items to Vault (${path.basename(timestampedPath)}) and cleaned active catalog.`;
      await connection.query(
        `INSERT INTO archive_audit_logs (entity_type, entity_id, entity_name, action, actor_name, note)
         VALUES ('catalog_vault', 0, 'Inventory & Menu Catalog', 'vault_archived_and_cleaned', 'Control Panel', ?)`,
        [note.slice(0, 255)],
      );

      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      await connection.commit();
    } catch (txErr) {
      await connection.rollback();
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      } catch {
        // ignore
      }
      throw txErr;
    }

    console.log(
      `[Catalog Vault] Clean slate ready! Active Menu Products = 0, Active Inventory Items = 0 (Categories, Orders & Accounts preserved).`,
    );
    const payload = {
      ok: true,
      alreadyClean: false,
      liveMenu: 0,
      liveInventory: 0,
      hasBackup: true,
      backupTimestamp: snapshot.createdAt,
      backupMenu: liveMenuCount,
      backupInventory: liveInventoryCount,
    };
    console.log(`VAULT_STATUS_JSON:${JSON.stringify(payload)}`);
  } finally {
    connection.release();
  }
}

async function runRecover(customFilename = null) {
  await mkdir(BACKUPS_DIR, { recursive: true });
  const targetPath = customFilename
    ? path.isAbsolute(customFilename)
      ? customFilename
      : path.join(BACKUPS_DIR, customFilename)
    : LATEST_BACKUP_PATH;

  if (!existsSync(targetPath)) {
    console.error(
      `[Catalog Vault Error] No archived snapshot found at ${targetPath}. Please run 'archive-clean' first.`,
    );
    process.exitCode = 1;
    return;
  }

  const raw = await readFile(targetPath, "utf8");
  const snapshot = JSON.parse(raw);
  const tables = snapshot?.tables;
  if (!tables || typeof tables !== "object") {
    console.error(`[Catalog Vault Error] Invalid snapshot file format in ${targetPath}.`);
    process.exitCode = 1;
    return;
  }

  const connection = await pool.getConnection();
  try {
    // Safety net: if live DB currently has any rows in menu_products or inventory_items, back them up first
    const currentLive = await fetchSnapshotFromDb(connection);
    const currentMenuCount = currentLive.tables.menu_products.length;
    const currentInvCount = currentLive.tables.inventory_items.length;

    if (currentMenuCount > 0 || currentInvCount > 0) {
      const preRecPath = path.join(BACKUPS_DIR, `pre_recovery_${formatTimestampForFilename()}.json`);
      await writeFile(preRecPath, JSON.stringify(currentLive, null, 2), "utf8");
      console.log(
        `[Catalog Vault] Saved safety snapshot of current live items (${currentMenuCount} Menu Products, ${currentInvCount} Inventory Items) to ${preRecPath}`,
      );
    }

    await ensureArchiveAuditSchema(connection);
    await connection.beginTransaction();
    try {
      await connection.query("SET FOREIGN_KEY_CHECKS = 0");

      // 1. Upsert categories first so all category IDs exist
      await upsertRowsIntoTable(connection, "menu_categories", tables.menu_categories || [], true);
      await upsertRowsIntoTable(connection, "inventory_categories", tables.inventory_categories || [], true);

      // 2. Clear active catalog & inventory tables before restoring exact archived rows
      for (const table of CLEAN_DELETE_TABLES) {
        if (await tableExists(connection, table)) {
          await connection.query(`DELETE FROM \`${table}\``);
          try {
            await connection.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = 1`);
          } catch {
            // Ignore if table has no auto-increment column
          }
        }
      }

      // 3. Re-insert all archived rows preserving primary keys, timestamps, decimals, and recipes
      for (const table of RECOVER_DATA_TABLES) {
        const rows = tables[table] || [];
        if (rows.length > 0) {
          await upsertRowsIntoTable(connection, table, rows, false);
        }
      }

      const restoredMenu = (tables.menu_products || []).length;
      const restoredInv = (tables.inventory_items || []).length;
      const restoredSizes = (tables.product_sizes || []).length;
      const restoredSizeRecipes = (tables.product_size_ingredients || []).length;

      const note = `Recovered ${restoredMenu} menu products, ${restoredInv} inventory items, ${restoredSizes} sizes, and ${restoredSizeRecipes} recipe lines from Vault.`;
      await connection.query(
        `INSERT INTO archive_audit_logs (entity_type, entity_id, entity_name, action, actor_name, note)
         VALUES ('catalog_vault', 0, 'Inventory & Menu Catalog', 'vault_recovered', 'Control Panel', ?)`,
        [note.slice(0, 255)],
      );

      await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      await connection.commit();

      console.log(
        `[Catalog Vault] Recovery complete! Restored ${restoredMenu} Menu Products, ${restoredInv} Inventory Items, ${restoredSizes} Product Sizes, and ${restoredSizeRecipes} Size Recipe Lines.`,
      );
      const payload = {
        ok: true,
        liveMenu: restoredMenu,
        liveInventory: restoredInv,
        hasBackup: true,
        backupTimestamp: snapshot.createdAt || null,
        backupMenu: restoredMenu,
        backupInventory: restoredInv,
      };
      console.log(`VAULT_STATUS_JSON:${JSON.stringify(payload)}`);
    } catch (txErr) {
      await connection.rollback();
      try {
        await connection.query("SET FOREIGN_KEY_CHECKS = 1");
      } catch {
        // ignore
      }
      throw txErr;
    }
  } finally {
    connection.release();
  }
}

async function main() {
  const command = (process.argv[2] || "status").toLowerCase();
  const arg = process.argv[3] || null;
  const force = process.argv.includes("--force");

  try {
    if (command === "status") {
      await runStatus();
    } else if (command === "archive-clean") {
      await runArchiveAndClean(force);
    } else if (command === "recover") {
      await runRecover(arg && !arg.startsWith("--") ? arg : null);
    } else {
      console.error(`Unknown catalog-vault command: '${command}'. Use: status | archive-clean | recover`);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[Catalog Vault Error] ${err?.message || err}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
