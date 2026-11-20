/**
 * Logical database backup (mysqldump --single-transaction) for Amaya.
 *
 * Usage:
 *   node src/backup-db.js [--reason daily|pre-migrate|pre-vault|manual] [--if-older-than-hours N]
 *
 * - Writes database/backups/auto/<db>_<reason>_<timestamp>.sql via a .tmp file and only
 *   renames it after verifying mysqldump's "-- Dump completed" trailer, so a crash or a
 *   failed dump never leaves a file that looks like a good backup.
 * - The DB password is passed through MYSQL_PWD (never on the command line).
 * - Keeps the newest KEEP_PER_REASON[reason] backups per reason and deletes older ones.
 * - Prints BACKUP_OK:<path> or BACKUP_SKIPPED:<path> and exits 0; exits 1 on failure.
 *
 * Never copy the live data folder (ibdata1/*.ibd) while mysqld runs; use this instead.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const ROOT_DIR = path.resolve(__dirname, "../..");
export const DEFAULT_BACKUP_DIR = path.join(ROOT_DIR, "database", "backups", "auto");
export const KEEP_PER_REASON = { daily: 14, "pre-migrate": 10, "pre-vault": 10, manual: 10 };
const VALID_REASONS = Object.keys(KEEP_PER_REASON);
const DUMP_TRAILER = "-- Dump completed";

function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function backupFileName(dbName, reason, date = new Date()) {
  return `${dbName}_${reason}_${timestamp(date)}.sql`;
}

function parseBackupName(fileName, dbName) {
  const match = fileName.match(/^(.+)_(daily|pre-migrate|pre-vault|manual)_(\d{8}_\d{6})\.sql$/);
  if (!match || match[1] !== dbName) return null;
  return { reason: match[2], stamp: match[3] };
}

export async function listBackups(dir, dbName) {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names
    .map((name) => ({ name, parsed: parseBackupName(name, dbName) }))
    .filter((entry) => entry.parsed)
    .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name), ...entry.parsed }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

/** Newest backup of `reason` younger than `maxAgeHours`, or null. */
export async function findFreshBackup(dir, dbName, reason, maxAgeHours, now = Date.now()) {
  for (const backup of await listBackups(dir, dbName)) {
    if (backup.reason !== reason) continue;
    const info = await stat(backup.path);
    if (now - info.mtimeMs < maxAgeHours * 3600 * 1000) return backup;
  }
  return null;
}

/** Delete all but the newest `keep` backups of `reason`. Returns deleted file names. */
export async function pruneBackups(dir, dbName, reason, keep) {
  const sameReason = (await listBackups(dir, dbName)).filter((b) => b.reason === reason);
  const stale = sameReason.slice(keep);
  for (const backup of stale) await rm(backup.path, { force: true });
  return stale.map((b) => b.name);
}

export async function hasDumpTrailer(filePath) {
  const handle = await open(filePath, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, 512);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString("utf8").includes(DUMP_TRAILER);
  } finally {
    await handle.close();
  }
}

function resolveMysqldump() {
  if (process.env.MYSQLDUMP_PATH) return process.env.MYSQLDUMP_PATH;
  const xampp = "C:\\xampp\\mysql\\bin\\mysqldump.exe";
  return existsSync(xampp) ? xampp : "mysqldump";
}

function runMysqldump(outPath, { host, port, user, password, database }) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(outPath);
    const child = spawn(
      resolveMysqldump(),
      [
        `--host=${host}`,
        `--port=${port}`,
        `--user=${user}`,
        "--single-transaction",
        "--routines",
        "--triggers",
        "--hex-blob",
        "--default-character-set=utf8mb4",
        database,
      ],
      { env: { ...process.env, MYSQL_PWD: password }, windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.pipe(out);
    child.on("error", (error) => { out.destroy(); reject(error); });
    child.on("close", (code) => {
      out.end(() => {
        if (code === 0) resolve();
        else reject(new Error(`mysqldump exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
      });
    });
  });
}

export async function runBackup({
  reason = "manual",
  ifOlderThanHours = null,
  backupDir = process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR,
} = {}) {
  if (!VALID_REASONS.includes(reason)) {
    throw new Error(`Unknown backup reason '${reason}'. Use one of: ${VALID_REASONS.join(", ")}.`);
  }
  const database = process.env.DB_NAME || "amaya";
  await mkdir(backupDir, { recursive: true });

  if (ifOlderThanHours != null) {
    const fresh = await findFreshBackup(backupDir, database, reason, ifOlderThanHours);
    if (fresh) return { skipped: true, path: fresh.path, pruned: [] };
  }

  const finalPath = path.join(backupDir, backupFileName(database, reason));
  const tmpPath = `${finalPath}.tmp`;
  try {
    await runMysqldump(tmpPath, {
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database,
    });
    if (!(await hasDumpTrailer(tmpPath))) {
      throw new Error("Backup is incomplete: mysqldump did not write its 'Dump completed' trailer.");
    }
    await rename(tmpPath, finalPath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
  const pruned = await pruneBackups(backupDir, database, reason, KEEP_PER_REASON[reason]);
  return { skipped: false, path: finalPath, pruned };
}

function parseArgs(argv) {
  const args = { reason: "manual", ifOlderThanHours: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--reason") args.reason = argv[++i];
    else if (argv[i] === "--if-older-than-hours") args.ifOlderThanHours = Number(argv[++i]);
  }
  if (args.ifOlderThanHours != null && !(args.ifOlderThanHours > 0)) {
    throw new Error("--if-older-than-hours must be a positive number.");
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runBackup(parseArgs(process.argv.slice(2)));
    if (result.skipped) {
      console.log(`Recent backup already exists, skipping.`);
      console.log(`BACKUP_SKIPPED:${result.path}`);
    } else {
      console.log(`Database backup written and verified.`);
      if (result.pruned.length) console.log(`Removed ${result.pruned.length} older backup(s).`);
      console.log(`BACKUP_OK:${result.path}`);
    }
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
    process.exit(1);
  }
}
