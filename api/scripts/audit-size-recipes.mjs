import "dotenv/config";
import pool from "../src/database.js";
const [sizes] = await pool.execute(`SELECT ps.id size_id, mp.name product, ps.label, COUNT(psi.id) rows_, GROUP_CONCAT(CONCAT(i.name,'=',psi.quantity_used,psi.unit) ORDER BY psi.id SEPARATOR ' | ') recipe FROM product_sizes ps JOIN menu_products mp ON mp.id=ps.product_id LEFT JOIN product_size_ingredients psi ON psi.product_size_id=ps.id LEFT JOIN inventory_items i ON i.id=psi.inventory_item_id GROUP BY ps.id ORDER BY mp.id, ps.display_order`);
const [base] = await pool.execute(`SELECT pi.product_id, GROUP_CONCAT(pi.inventory_item_id ORDER BY pi.inventory_item_id) ids FROM product_ingredients pi GROUP BY pi.product_id`);
console.table(sizes); console.table(base);
const [sz] = await pool.execute(`SELECT ps.id, ps.product_id, GROUP_CONCAT(psi.inventory_item_id ORDER BY psi.inventory_item_id) ids FROM product_sizes ps LEFT JOIN product_size_ingredients psi ON psi.product_size_id=ps.id GROUP BY ps.id`);
for (const s of sz) { const b = base.find(x=>x.product_id===s.product_id); console.log(`size ${s.id}: ${s.ids ? (s.ids===b?.ids ? "COMPLETE (matches base item set)" : "DIFFERS from base set: "+s.ids+" vs "+b?.ids) : "NO ROWS -> falls back to base"}`); }
await pool.end();
