import { open, readFile, rename, rm } from "node:fs/promises";

/**
 * Write `text` so the file either holds the complete, verified content or does not exist:
 * write to <path>.tmp, fsync it to disk, read it back and run `verify(readBackText)`,
 * then rename it into place. Throws (and removes the temp file) if anything fails, so
 * callers can safely refuse to continue (e.g. never wipe data without a good backup).
 */
export async function writeVerifiedFile(filePath, text, verify = () => {}) {
  const tmpPath = `${filePath}.tmp`;
  try {
    const handle = await open(tmpPath, "w");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const readBack = await readFile(tmpPath, "utf8");
    if (readBack !== text) throw new Error(`Backup read-back mismatch for ${filePath}.`);
    await verify(readBack);
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

/** Verifier for Catalog Vault snapshots: must parse and hold the expected row counts. */
export function vaultSnapshotVerifier(expectedCounts) {
  return (text) => {
    const parsed = JSON.parse(text);
    for (const [table, count] of Object.entries(expectedCounts)) {
      const actual = parsed?.tables?.[table]?.length ?? -1;
      if (actual !== count) {
        throw new Error(`Backup verification failed: ${table} has ${actual} rows, expected ${count}.`);
      }
    }
  };
}
