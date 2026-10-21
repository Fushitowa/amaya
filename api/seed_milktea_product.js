import pool from "./src/database.js";

async function seed() {
  const conn = await pool.getConnection();
  console.log("Connected to database via pool.");
  try {

  // 1. Clean up old archived test records
  await conn.query("DELETE FROM inventory_movements WHERE inventory_item_id = 6");
  await conn.query("DELETE FROM inventory_items WHERE id = 6 OR name IN ('milk powder', 'Milk Powder', '16oz Cup', 'Black Pearl (Sago)', 'Ice Cubes')");
  await conn.query("DELETE FROM product_sizes WHERE product_id = 3");
  await conn.query("DELETE FROM menu_products WHERE id = 3 OR name IN ('Milktea', 'Milk Tea')");

  // 2. Budget and define the 4 core inventory items
  // Total cost per 16oz serving:
  // - 16oz Cup: 1 pc @ ₱2.5000 = ₱2.50
  // - Milk Powder: 30 g @ ₱0.1800/g = ₱5.40
  // - Black Pearl (Sago): 40 g @ ₱0.1200/g = ₱4.80
  // - Ice Cubes: 150 g @ ₱0.0070/g = ₱1.05
  // Total COGS: ₱13.75 (Food Cost: 34.38%, Gross Profit: ₱26.25 / 65.63%)
  const items = [
    {
      name: "16oz Cup",
      category: "Packaging & Disposables",
      quantity: 100.000,
      unit: "pcs",
      minimum_stock: 25.000,
      purchase_price: 125.00,
      package_quantity: 1.000,
      package_unit: "pack",
      contents_per_package: 50.000,
      unit_cost: 2.5000,
    },
    {
      name: "Milk Powder",
      category: "Dairy & Creamers",
      quantity: 2000.000,
      unit: "g",
      minimum_stock: 400.000,
      purchase_price: 180.00,
      package_quantity: 1.000,
      package_unit: "pack",
      contents_per_package: 1000.000,
      unit_cost: 0.1800,
    },
    {
      name: "Black Pearl (Sago)",
      category: "Toppings & Add-ons",
      quantity: 2000.000,
      unit: "g",
      minimum_stock: 500.000,
      purchase_price: 120.00,
      package_quantity: 1.000,
      package_unit: "pack",
      contents_per_package: 1000.000,
      unit_cost: 0.1200,
    },
    {
      name: "Ice Cubes",
      category: "Store & Cleaning Supplies",
      quantity: 10000.000,
      unit: "g",
      minimum_stock: 2000.000,
      purchase_price: 35.00,
      package_quantity: 1.000,
      package_unit: "bag",
      contents_per_package: 5000.000,
      unit_cost: 0.0070,
    },
  ];

  const inventoryItemMap = new Map();

  for (const item of items) {
    const [res] = await conn.execute(
      `INSERT INTO inventory_items (
         name, category, quantity, unit, minimum_stock,
         added_from_menu, is_archived, purchase_price,
         package_quantity, package_unit, contents_per_package, unit_cost
       ) VALUES (?, ?, ?, ?, ?, FALSE, FALSE, ?, ?, ?, ?, ?)`,
      [
        item.name, item.category, item.quantity, item.unit, item.minimum_stock,
        item.purchase_price, item.package_quantity, item.package_unit, item.contents_per_package, item.unit_cost,
      ],
    );
    const itemId = res.insertId;
    inventoryItemMap.set(item.name, itemId);

    // Record opening stock movement
    await conn.execute(
      `INSERT INTO inventory_movements (inventory_item_id, user_id, movement_type, quantity_change, note)
       VALUES (?, 1, 'restock', ?, 'Opening stock for Milk Tea launch')`,
      [itemId, item.quantity],
    );
    console.log(`Created inventory item: ${item.name} (ID: ${itemId}, Stock: ${item.quantity} ${item.unit}, Unit Cost: ₱${item.unit_cost})`);
  }

  // 3. Ensure Category "Milk Tea" exists
  const [catRows] = await conn.execute(
    "INSERT INTO menu_categories (name, description, display_order, is_active) VALUES (?, ?, 1, TRUE) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
    ["Milk Tea", "Creamy and sweet milktea selections."],
  );
  let categoryId = catRows.insertId;
  if (!categoryId) {
    const [[existingCat]] = await conn.execute("SELECT id FROM menu_categories WHERE name = 'Milk Tea'");
    categoryId = existingCat?.id || 1;
  }

  // 4. Create the menu product "Milk Tea"
  const [prodRes] = await conn.execute(
    `INSERT INTO menu_products (
       category_id, name, description, image_url, base_price, stock_quantity, is_available, is_featured, display_order, is_archived
     ) VALUES (?, ?, ?, NULL, 40.00, 50, TRUE, TRUE, 1, FALSE)`,
    [
      categoryId,
      "Milk Tea",
      "Amaya's signature creamy milk tea infused with premium black tea, served over ice with freshly prepared chewy black pearls (sago).",
    ],
  );
  const productId = prodRes.insertId;
  console.log(`Created menu product: Milk Tea (ID: ${productId}, Price: ₱40.00)`);

  // 5. Create product size: "Regular (16oz)" @ ₱40.00
  const [sizeRes] = await conn.execute(
    `INSERT INTO product_sizes (product_id, label, price, display_order)
     VALUES (?, 'Regular (16oz)', 40.00, 0)`,
    [productId],
  );
  const sizeId = sizeRes.insertId;
  console.log(`Created product size: Regular (16oz) (ID: ${sizeId}, Price: ₱40.00)`);

  // 6. Create base product ingredients
  const recipe = [
    { name: "16oz Cup", qty: 1.000, unit: "pcs" },
    { name: "Milk Powder", qty: 30.000, unit: "g" },
    { name: "Black Pearl (Sago)", qty: 40.000, unit: "g" },
    { name: "Ice Cubes", qty: 150.000, unit: "g" },
  ];

  for (const ing of recipe) {
    const invId = inventoryItemMap.get(ing.name);
    await conn.execute(
      `INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_used, unit)
       VALUES (?, ?, ?, ?)`,
      [productId, invId, ing.qty, ing.unit],
    );

    // Also populate product_size_ingredients for the size
    await conn.execute(
      `INSERT INTO product_size_ingredients (product_size_id, inventory_item_id, quantity_used, unit)
       VALUES (?, ?, ?, ?)`,
      [sizeId, invId, ing.qty, ing.unit],
    );
    console.log(`Linked recipe ingredient: ${ing.name} (${ing.qty} ${ing.unit} per 16oz serving)`);
  }

  // 7. Create add-on "Extra Black Pearl (Sago)"
  const pearlId = inventoryItemMap.get("Black Pearl (Sago)");
  await conn.execute(
    `INSERT INTO product_addons (product_id, label, price, inventory_item_id, quantity_used, usage_unit, display_order)
     VALUES (?, 'Extra Black Pearl (Sago)', 10.00, ?, 30.000, 'g', 0)`,
    [productId, pearlId],
  );
    console.log("SUCCESS: All Milk Tea menu product and inventory data successfully seeded!");
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch(console.error);
