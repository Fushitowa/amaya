import { toInventoryQuantity } from "./inventoryUnits.js";

const RECIPE_TABLES = [
  { select: "SELECT id, unit FROM product_ingredients WHERE inventory_item_id = ?", update: "UPDATE product_ingredients SET unit = ? WHERE id = ?" },
  { select: "SELECT id, unit FROM product_size_ingredients WHERE inventory_item_id = ?", update: "UPDATE product_size_ingredients SET unit = ? WHERE id = ?" },
  { select: "SELECT id, usage_unit AS unit FROM product_addons WHERE inventory_item_id = ?", update: "UPDATE product_addons SET usage_unit = ? WHERE id = ?" },
];

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * After an inventory item's unit changes, move its recipe/add-on rows onto the new unit.
 * Rows that used the old stock unit follow it (amount unchanged: 24 l -> 24 ml, the fix for a mislabeled unit).
 * Rows in another unit that still converts to the new one are left alone; rows that no longer convert follow too.
 */
export async function retargetRecipeUnits(connection, itemId, oldUnit, newUnit) {
  let changed = 0;
  for (const table of RECIPE_TABLES) {
    const [rows] = await connection.execute(table.select, [itemId]);
    for (const row of rows) {
      if (!same(row.unit, oldUnit) && toInventoryQuantity(1, row.unit, newUnit)) continue;
      await connection.execute(table.update, [newUnit, row.id]);
      changed += 1;
    }
  }
  return changed;
}
