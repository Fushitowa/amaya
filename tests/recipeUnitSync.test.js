import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { retargetRecipeUnits } from "../api/src/utils/recipeUnitSync.js";

// Fake connection: SELECTs return fixtures per table, UPDATEs are recorded.
function fakeConnection(fixtures) {
  const updates = [];
  return {
    updates,
    async execute(sql, params) {
      if (sql.startsWith("SELECT")) {
        const key = Object.keys(fixtures).find((table) => sql.includes(`FROM ${table} `));
        return [fixtures[key] || []];
      }
      updates.push({ sql, params });
      return [{}];
    },
  };
}

describe("Inventory unit change cascades to menu recipes", () => {
  it("relabels recipe rows that used the old stock unit (l -> ml keeps 24 as 24 ml)", async () => {
    const conn = fakeConnection({ product_ingredients: [{ id: 1, unit: "l" }] });
    const changed = await retargetRecipeUnits(conn, 7, "l", "ml");
    assert.equal(changed, 1);
    assert.deepEqual(conn.updates[0].params, ["ml", 1]);
  });

  it("keeps rows in another unit that still converts (g stays g when stock goes kg -> g)", async () => {
    const conn = fakeConnection({ product_ingredients: [{ id: 2, unit: "g" }] });
    assert.equal(await retargetRecipeUnits(conn, 7, "kg", "g"), 0);
  });

  it("moves rows that no longer convert, across ingredients, sizes and add-ons", async () => {
    const conn = fakeConnection({
      product_ingredients: [{ id: 3, unit: "pcs" }],
      product_size_ingredients: [{ id: 4, unit: "pcs" }],
      product_addons: [{ id: 5, unit: "pcs" }],
    });
    assert.equal(await retargetRecipeUnits(conn, 7, "pcs", "ml"), 3);
    assert.ok(conn.updates.some((u) => u.sql.includes("product_addons SET usage_unit")));
  });
});
