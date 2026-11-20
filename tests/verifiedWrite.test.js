import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vaultSnapshotVerifier, writeVerifiedFile } from "../api/src/utils/verifiedWrite.js";

// The Catalog Vault deletes the live catalog right after writing its backup, so the
// backup must be complete and verified first (audit finding F14).
describe("Verified backup writes (F14)", () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "amaya-verified-write-"));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const snapshot = (menu, inv) => JSON.stringify({
    tables: { menu_products: Array.from({ length: menu }, (_, i) => ({ id: i })), inventory_items: Array.from({ length: inv }, (_, i) => ({ id: i })) },
  });

  it("writes the file only after it verifies", async () => {
    const target = path.join(dir, "ok.json");
    await writeVerifiedFile(target, snapshot(2, 3), vaultSnapshotVerifier({ menu_products: 2, inventory_items: 3 }));
    assert.equal(JSON.parse(await readFile(target, "utf8")).tables.inventory_items.length, 3);
    assert.equal(existsSync(`${target}.tmp`), false);
  });

  it("throws and leaves no file when verification fails", async () => {
    const target = path.join(dir, "bad.json");
    await assert.rejects(
      writeVerifiedFile(target, snapshot(1, 1), vaultSnapshotVerifier({ menu_products: 2, inventory_items: 1 })),
      /verification failed/,
    );
    assert.equal(existsSync(target), false);
    assert.equal(existsSync(`${target}.tmp`), false);
  });

  it("does not overwrite a good existing backup with a bad one", async () => {
    const target = path.join(dir, "keep.json");
    await writeVerifiedFile(target, snapshot(5, 5));
    await assert.rejects(writeVerifiedFile(target, "{not json", vaultSnapshotVerifier({ menu_products: 0 })));
    assert.equal(JSON.parse(await readFile(target, "utf8")).tables.menu_products.length, 5);
  });
});
