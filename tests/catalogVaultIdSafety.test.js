import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

// Archive & Clean deletes catalog rows but keeps orders, inventory movements and
// consumptions that reference their IDs. Resetting AUTO_INCREMENT would hand those old
// IDs to new items and silently attach old history to them (audit finding F13).
// A live run would wipe the shared test database's categories, so this guards the source.
describe("Catalog Vault never reuses product or ingredient IDs", () => {
  it("does not reset AUTO_INCREMENT on any table", async () => {
    const source = await fs.readFile(path.resolve("api/src/catalog-vault.js"), "utf8");
    const executable = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(executable, /AUTO_INCREMENT\s*=/i);
  });
});
