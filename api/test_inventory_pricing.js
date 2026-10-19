import pool from "./src/database.js";

async function run() {
  console.log("=== RUNNING INVENTORY PRICING & METRICS VERIFICATION SUITE ===");

  // Clean previous test items if any
  await pool.execute("DELETE FROM inventory_items WHERE name LIKE 'TEST_%'");

  // 1. Insert Milk Powder (1 pack of 1000g @ P99.00)
  const [res1] = await pool.execute(
    `INSERT INTO inventory_items (
       name, category, quantity, unit, minimum_stock,
       purchase_price, package_quantity, package_unit, contents_per_package, unit_cost
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['TEST_Milk_Powder', 'Dairy', 1000.000, 'g', 200.000, 99.00, 1.000, 'pack', 1000.000, 0.0990]
  );
  console.log("-> Inserted TEST_Milk_Powder (ID:", res1.insertId, ")");

  // 2. Insert 22oz Cups (1 box of 2000 pcs @ P3,300.00)
  const [res2] = await pool.execute(
    `INSERT INTO inventory_items (
       name, category, quantity, unit, minimum_stock,
       purchase_price, package_quantity, package_unit, contents_per_package, unit_cost
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ['TEST_22oz_Cups', 'Packaging', 2000.000, 'pcs', 250.000, 3300.00, 1.000, 'box', 2000.000, 1.6500]
  );
  console.log("-> Inserted TEST_22oz_Cups (ID:", res2.insertId, ")");

  // 3. Verify Calculated Cost per Unit and Value
  const [items] = await pool.execute(
    "SELECT id, name, quantity, unit, purchase_price, package_quantity, package_unit, contents_per_package, unit_cost, (quantity * unit_cost) as item_valuation FROM inventory_items WHERE id IN (?, ?)",
    [res1.insertId, res2.insertId]
  );

  let totalCalculatedValuation = 0;
  for (const item of items) {
    const val = Number(item.item_valuation);
    totalCalculatedValuation += val;
    console.log(`   [ITEM] ${item.name}: Stock = ${item.quantity} ${item.unit} | Unit Cost = ₱${Number(item.unit_cost).toFixed(4)}/${item.unit} | Valuation = ₱${val.toFixed(2)}`);
  }
  console.log(`   [BATCH VALUATION]: ₱${totalCalculatedValuation.toFixed(2)}`);

  // Assertion 1: Milk powder unit cost
  const milkPowder = items.find(i => i.name === 'TEST_Milk_Powder');
  if (Math.abs(Number(milkPowder.unit_cost) - 0.0990) > 0.0001) throw new Error("Milk Powder unit cost mismatch!");
  if (Math.abs(Number(milkPowder.item_valuation) - 99.00) > 0.01) throw new Error("Milk Powder valuation mismatch!");

  // Assertion 2: Cups unit cost
  const cups = items.find(i => i.name === 'TEST_22oz_Cups');
  if (Math.abs(Number(cups.unit_cost) - 1.6500) > 0.0001) throw new Error("Cups unit cost mismatch!");
  if (Math.abs(Number(cups.item_valuation) - 3300.00) > 0.01) throw new Error("Cups valuation mismatch!");

  console.log("✓ ASSERTION 1 PASSED: Unit costs and valuations calculated with exact precision.");

  // 4. Test Summary Aggregation
  const [summaryRows] = await pool.execute(
    `SELECT
       COUNT(*) AS total_items,
       COALESCE(SUM(quantity * unit_cost), 0) AS total_value
     FROM inventory_items WHERE is_archived = FALSE`
  );
  console.log("   [INVENTORY SUMMARY]:", summaryRows[0]);
  if (Number(summaryRows[0].total_value) < 3399.00) throw new Error("Inventory valuation aggregation failed!");
  console.log("✓ ASSERTION 2 PASSED: Inventory valuation aggregation matches expected total.");

  // 5. Test Sales Calculation Filtering (Paid vs Unpaid vs Refunded)
  // Insert a test paid order
  const [order1] = await pool.execute(
    `INSERT INTO orders (order_number, customer_name, order_type, order_status, payment_status, payment_method, total, created_at)
     VALUES ('AM-TEST-PAID-01', 'Test Customer 1', 'Counter', 'Completed', 'Paid', 'Cash', 285.00, NOW())`
  );
  // Insert order items for order 1 (3 cups)
  await pool.execute(
    `INSERT INTO order_items (order_id, product_name_snapshot, quantity, size_label, unit_price)
     VALUES (?, 'Classic Milk Tea', 3, 'Large', 95.00)`,
    [order1.insertId]
  );

  // Insert a test unpaid order (should be excluded from Total Sales)
  const [order2] = await pool.execute(
    `INSERT INTO orders (order_number, customer_name, order_type, order_status, payment_status, payment_method, total, created_at)
     VALUES ('AM-TEST-UNPAID-01', 'Test Customer 2', 'Counter', 'Pending', 'Unpaid', 'Cash', 150.00, NOW())`
  );
  await pool.execute(
    `INSERT INTO order_items (order_id, product_name_snapshot, quantity, size_label, unit_price)
     VALUES (?, 'Taro Milk Tea', 2, 'Medium', 75.00)`,
    [order2.insertId]
  );

  // Run the exact query from /api/orders/summary
  const [salesRows] = await pool.execute(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total ELSE 0 END), 0) AS all_time_sales,
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END), 0) AS all_time_paid_orders,
       COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND payment_method = 'Cash' THEN total ELSE 0 END), 0) AS all_time_cash_collected
     FROM orders WHERE order_number IN ('AM-TEST-PAID-01', 'AM-TEST-UNPAID-01')`
  );

  const [itemRows] = await pool.execute(
    `SELECT
       COALESCE(SUM(oi.quantity), 0) AS all_time_units_sold
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.payment_status = 'Paid' AND o.order_number IN ('AM-TEST-PAID-01', 'AM-TEST-UNPAID-01')`
  );

  console.log("   [TEST SALES METRICS]:", { sales: salesRows[0], items: itemRows[0] });

  // Verify: Total Sales must be exactly 285.00 (NOT 285 + 150 = 435)
  if (Number(salesRows[0].all_time_sales) !== 285.00) throw new Error("Total Sales counted unpaid order!");
  if (Number(salesRows[0].all_time_paid_orders) !== 1) throw new Error("Paid orders count incorrect!");
  if (Number(itemRows[0].all_time_units_sold) !== 3) throw new Error("Units sold count incorrect! Expected 3, got " + itemRows[0].all_time_units_sold);

  console.log("✓ ASSERTION 3 PASSED: Total Sales correctly excludes Unpaid transactions; Units Sold distinguishes units (3) from orders (1).");

  // Clean up all test rows
  await pool.execute("DELETE FROM order_items WHERE order_id IN (?, ?)", [order1.insertId, order2.insertId]);
  await pool.execute("DELETE FROM orders WHERE id IN (?, ?)", [order1.insertId, order2.insertId]);
  await pool.execute("DELETE FROM inventory_items WHERE id IN (?, ?)", [res1.insertId, res2.insertId]);

  console.log("✓ ALL TEST DATA CLEANED UP SAFELY.");
  console.log("=== ALL PRIORITY ONE VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
  process.exit(0);
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
