import { toInventoryQuantity } from "./inventoryUnits.js";

const RECIPE_TABLES = [
  {
    select: "SELECT id, quantity_used, unit FROM product_ingredients WHERE inventory_item_id = ?",
    updateUnitOnly: "UPDATE product_ingredients SET unit = ? WHERE id = ?",
    updateUnitAndQty: "UPDATE product_ingredients SET unit = ?, quantity_used = ? WHERE id = ?",
  },
  {
    select: "SELECT id, quantity_used, unit FROM product_size_ingredients WHERE inventory_item_id = ?",
    updateUnitOnly: "UPDATE product_size_ingredients SET unit = ? WHERE id = ?",
    updateUnitAndQty: "UPDATE product_size_ingredients SET unit = ?, quantity_used = ? WHERE id = ?",
  },
  {
    select: "SELECT id, quantity_used, usage_unit AS unit FROM product_addons WHERE inventory_item_id = ?",
    updateUnitOnly: "UPDATE product_addons SET usage_unit = ? WHERE id = ?",
    updateUnitAndQty: "UPDATE product_addons SET usage_unit = ?, quantity_used = ? WHERE id = ?",
  },
];

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * After an inventory item's unit changes, retarget its recipe/add-on rows onto the new unit.
 * - Rows in another unit that still converts to the new stock unit are left untouched.
 * - Rows that used the old stock unit scale `quantity_used` when converting within the same
 *   dimension (e.g. g <-> kg, l <-> ml) and fall back to unit-only update when cross-dimension.
 */
export async function retargetRecipeUnits(connection, itemId, oldUnit, newUnit) {
  let changed = 0;
  for (const table of RECIPE_TABLES) {
    const [rows] = await connection.execute(table.select, [itemId]);
    for (const row of rows) {
      if (!same(row.unit, oldUnit) && toInventoryQuantity(1, row.unit, newUnit)) continue;
      if (same(row.unit, oldUnit) && row.quantity_used != null) {
        const numericQty = Number(row.quantity_used);
        const scaledQty = Number.isFinite(numericQty) && numericQty > 0
          ? toInventoryQuantity(numericQty, oldUnit, newUnit)
          : null;
        if (scaledQty != null) {
          await connection.execute(table.updateUnitAndQty, [newUnit, scaledQty, row.id]);
          changed += 1;
          continue;
        }
      }
      await connection.execute(table.updateUnitOnly, [newUnit, row.id]);
      changed += 1;
    }
  }
  return changed;
}
