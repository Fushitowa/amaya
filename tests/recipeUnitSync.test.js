import "./helpers/loadEnv.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { retargetRecipeUnits } from "../api/src/utils/recipeUnitSync.js";
import { toInventoryQuantity } from "../api/src/utils/inventoryUnits.js";

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
  it("scales quantity_used when retargeting same-dimension units (l -> ml, kg <-> g)", async () => {
    const conn = fakeConnection({
      product_ingredients: [
        { id: 1, quantity_used: 0.25, unit: "l" },
        { id: 2, quantity_used: 15, unit: "ml" },
      ],
      product_size_ingredients: [{ id: 3, quantity_used: 0.5, unit: "l" }],
      product_addons: [{ id: 4, quantity_used: 0.05, unit: "l" }],
    });

    const changedVol = await retargetRecipeUnits(conn, 7, "l", "ml");
    assert.equal(changedVol, 3);
    assert.deepEqual(conn.updates[0].params, ["ml", 250, 1]);
    assert.deepEqual(conn.updates[1].params, ["ml", 500, 3]);
    assert.deepEqual(conn.updates[2].params, ["ml", 50, 4]);

    const connMass = fakeConnection({
      product_ingredients: [{ id: 2, quantity_used: 250, unit: "g" }],
      product_size_ingredients: [{ id: 3, quantity_used: 1.5, unit: "kg" }],
    });
    assert.equal(await retargetRecipeUnits(connMass, 7, "g", "kg"), 1);
    assert.deepEqual(connMass.updates[0].params, ["kg", 0.25, 2]);
    assert.ok(connMass.updates[0].sql.includes("quantity_used = ?"));
  });

  it("keeps rows in another unit that still converts (g stays g when stock goes kg -> g)", async () => {
    const conn = fakeConnection({ product_ingredients: [{ id: 2, quantity_used: 50, unit: "g" }] });
    assert.equal(await retargetRecipeUnits(conn, 7, "kg", "g"), 0);
    assert.equal(conn.updates.length, 0);
  });

  it("moves rows that no longer convert across ingredients, sizes and add-ons without scaling", async () => {
    const conn = fakeConnection({
      product_ingredients: [{ id: 3, quantity_used: 2, unit: "pcs" }],
      product_size_ingredients: [{ id: 4, quantity_used: 1, unit: "pcs" }],
      product_addons: [{ id: 5, quantity_used: 1, unit: "pcs" }],
    });
    assert.equal(await retargetRecipeUnits(conn, 7, "pcs", "ml"), 3);
    assert.deepEqual(conn.updates[0].params, ["ml", 3]);
    assert.deepEqual(conn.updates[1].params, ["ml", 4]);
    assert.ok(conn.updates.some((u) => u.sql.includes("product_addons SET usage_unit")));
  });

  it("converts discrete 'can' and 'cans' units seamlessly", () => {
    assert.equal(toInventoryQuantity(1, "can", "can"), 1);
    assert.equal(toInventoryQuantity(2, "cans", "can"), 2);
    assert.equal(toInventoryQuantity(0.5, "can", "can"), 0.5);
    assert.equal(toInventoryQuantity(1, "can", "pcs"), 1);
    assert.equal(toInventoryQuantity(12, "cans", "dozen"), 1);
    assert.equal(toInventoryQuantity(1, "can", "g"), null);
  });
});
