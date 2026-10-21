// Checks per-size recipe selection and deductions. Everything runs in ONE transaction that is
// always rolled back, so live stock, recipes and orders are never changed.
import "dotenv/config";
import assert from "node:assert/strict";
import pool from "../src/database.js";
import { listProducts } from "../src/routes/menu.js";
import { selectRecipe } from "../src/routes/orders.js";
import { toInventoryQuantity } from "../src/utils/inventoryUnits.js";

const liveSnapshot = async () => JSON.stringify((await pool.execute("SELECT id, quantity, maximum_stock FROM inventory_items ORDER BY id"))[0]);
const before = await liveSnapshot();
const conn = await pool.getConnection();
let failed = false;
try {
  await conn.beginTransaction();
  const addItem = async (name, unit) => (await conn.execute("INSERT INTO inventory_items (name, category, quantity, unit, unit_cost) VALUES (?, 'ZZTEST', 1000, ?, 1)", [name, unit]))[0].insertId;
  const cup16 = await addItem("ZZTEST 16oz Cup", "pcs");
  const cup22 = await addItem("ZZTEST 22oz Cup", "pcs");
  const milk = await addItem("ZZTEST Milk", "g");
  const [[{ category_id: categoryId }]] = await conn.execute("SELECT category_id FROM menu_products LIMIT 1");
  const productId = (await conn.execute("INSERT INTO menu_products (category_id, name, base_price, stock_quantity, is_available) VALUES (?, 'ZZTEST Tea', 40, 0, TRUE)", [categoryId]))[0].insertId;
  const addSize = async (label, price, order) => (await conn.execute("INSERT INTO product_sizes (product_id, label, price, display_order) VALUES (?, ?, ?, ?)", [productId, label, price, order]))[0].insertId;
  const regular = await addSize("Regular (16oz)", 40, 0);
  const medium = await addSize("Medium (18oz)", 50, 1); // no own rows -> base recipe
  const large = await addSize("Large (22oz)", 60, 2);
  const recipe = async (table, key, id, item, qty, unit) => conn.execute(`INSERT INTO ${table} (${key}, inventory_item_id, quantity_used, unit) VALUES (?, ?, ?, ?)`, [id, item, qty, unit]);
  await recipe("product_ingredients", "product_id", productId, cup16, 1, "pcs");
  await recipe("product_ingredients", "product_id", productId, milk, 30, "g");
  await recipe("product_size_ingredients", "product_size_id", regular, cup16, 1, "pcs");
  await recipe("product_size_ingredients", "product_size_id", regular, milk, 30, "g");
  await recipe("product_size_ingredients", "product_size_id", large, cup22, 1, "pcs");
  await recipe("product_size_ingredients", "product_size_id", large, milk, 45, "g");

  // Same two recipe queries orders.js runs, scoped to the test product.
  const [baseRows] = await conn.execute("SELECT pi.inventory_item_id, pi.quantity_used, pi.unit AS recipe_unit, i.name AS inventory_name, i.unit AS inventory_unit FROM product_ingredients pi JOIN inventory_items i ON i.id = pi.inventory_item_id WHERE pi.product_id = ?", [productId]);
  const [sizeRows] = await conn.execute("SELECT psi.product_size_id, psi.inventory_item_id, psi.quantity_used, psi.unit AS recipe_unit, i.name AS inventory_name, i.unit AS inventory_unit FROM product_size_ingredients psi JOIN inventory_items i ON i.id = psi.inventory_item_id WHERE psi.product_size_id IN (?, ?, ?)", [regular, medium, large]);
  const toEntry = (row) => ({ inventoryItemId: Number(row.inventory_item_id), quantityPerServing: toInventoryQuantity(row.quantity_used, row.recipe_unit, row.inventory_unit) });
  const baseRecipe = baseRows.map(toEntry);
  const sizeRecipe = (sizeId) => sizeRows.filter((row) => Number(row.product_size_id) === sizeId).map(toEntry);

  // Order: 1x Regular, 3x Large, 2x Medium (no rows).
  const order = [[regular, 1], [large, 3], [medium, 2]];
  for (const [sizeId, qty] of order) {
    for (const usage of selectRecipe(sizeRecipe(sizeId), baseRecipe)) {
      await conn.execute("UPDATE inventory_items SET quantity = quantity - ? WHERE id = ?", [usage.quantityPerServing * qty, usage.inventoryItemId]);
    }
  }
  const qty = async (id) => Number((await conn.execute("SELECT quantity FROM inventory_items WHERE id = ?", [id]))[0][0].quantity);
  const used = { cup16: 1000 - (await qty(cup16)), cup22: 1000 - (await qty(cup22)), milk: 1000 - (await qty(milk)) };
  console.log("Order: 1x Regular + 3x Large + 2x Medium(no rows)\nDeducted:", used);
  assert.equal(used.cup16, 1 + 2, "16oz cup: 1 Regular + 2 Medium (base fallback)");
  assert.equal(used.cup22, 3, "22oz cup: only the 3 Large");
  assert.equal(used.milk, 30 + 3 * 45 + 2 * 30, "milk: 30 + 135 + 60");
  console.log("PASS deductions: Regular, Large with its own cup (no double cup), Medium falls back to base");

  // Menu side: effective recipes and per-size stock.
  const product = (await listProducts(true, true, conn)).find((p) => p.id === productId);
  const bySize = Object.fromEntries(product.sizes.map((s) => [s.label, s]));
  const names = (s) => s.ingredients.map((i) => i.name).sort().join(",");
  assert.equal(names(bySize["Large (22oz)"]), "ZZTEST 22oz Cup,ZZTEST Milk");
  assert.equal(names(bySize["Medium (18oz)"]), "ZZTEST 16oz Cup,ZZTEST Milk");
  console.table(product.sizes.map((s) => ({ size: s.label, stock: s.stock, recipe: names(s) })));
    await conn.execute("UPDATE inventory_items SET quantity = 0 WHERE id = ?", [cup22]);
  const out = (await listProducts(true, true, conn)).find((p) => p.id === productId);
  const stockOf = (label) => out.sizes.find((s) => s.label === label).stock;
  assert.equal(stockOf("Large (22oz)"), 0, "Large out when its own cup is out");
  assert.ok(stockOf("Regular (16oz)") >= 0);
  assert.equal(out.stock, Math.max(...out.sizes.map((s) => s.stock)), "product stock = best size");
  console.log("PASS menu: per-size ingredients and stock (Large 0 when 22oz cup is 0; product stock = best size)");
} catch (error) {
  failed = true;
  console.error("FAIL:", error.message);
} finally {
  await conn.rollback();
  conn.release();
}
const after = await liveSnapshot();
console.log(before === after ? "Live inventory unchanged after rollback: OK" : "WARNING: live inventory changed!");
const [[{ leftovers }]] = await pool.execute("SELECT COUNT(*) AS leftovers FROM inventory_items WHERE category = 'ZZTEST'");
console.log("Leftover test rows:", leftovers);
await pool.end();
process.exit(failed || before !== after || leftovers ? 1 : 0);
