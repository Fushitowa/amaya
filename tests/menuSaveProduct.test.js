import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { saveProduct, listProducts } from "../api/src/routes/menu.js";

describe("Tala Test Suite: saveProduct Validation & Integrity (Step 2 & 3a)", () => {
  after(async () => {
    await pool.end();
  });
  it("TEST 1 (Question 2 Proof): saveProduct saves exact drink ingredients without dropping or injecting cups", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Ensure test category exists in transaction
      const [catResult] = await connection.execute(
        "INSERT INTO menu_categories (name, operational_family) VALUES ('Test Drinks', 'drink') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
      );
      const testCatName = "Test Drinks";

      // Ensure test inventory items exist in transaction
      await connection.execute("INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('Matcha Powder', 'Ingredients', 500, 'g') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");
      await connection.execute("INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('Fresh Milk', 'Ingredients', 2000, 'ml') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");
      await connection.execute("INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('12oz Paper Cup', 'Cups & Lids', 100, 'pcs') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");
      await connection.execute("INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('Peanut Butter Cup', 'Ingredients', 50, 'pcs') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");

      const testDrinkPayload = {
        name: "Test Matcha Delight",
        category: testCatName,
        price: "95.00",
        description: "Fresh test matcha drink",
        available: true,
        sizes: [
          {
            label: "12oz",
            price: 95,
            ingredients: [
              { name: "Matcha Powder", quantityUsed: 15, unit: "g", stockUnit: "g" },
              { name: "Fresh Milk", quantityUsed: 150, unit: "ml", stockUnit: "ml" },
              { name: "12oz Paper Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
              { name: "Peanut Butter Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
            ],
          },
        ],
        ingredients: [
          { name: "Matcha Powder", quantityUsed: 15, unit: "g", stockUnit: "g" },
          { name: "Fresh Milk", quantityUsed: 150, unit: "ml", stockUnit: "ml" },
          { name: "12oz Paper Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
          { name: "Peanut Butter Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
        ],
      };

      const createdId = await saveProduct(connection, testDrinkPayload);
      assert(createdId > 0, "Product must be created successfully");

      // Verify exact ingredients saved in product_size_ingredients
      const [rows] = await connection.execute(
        `SELECT psi.quantity_used, psi.unit, i.name AS ingredient_name
           FROM product_size_ingredients psi
           JOIN inventory_items i ON i.id = psi.inventory_item_id
           JOIN product_sizes ps ON ps.id = psi.product_size_id
          WHERE ps.product_id = ?`,
        [createdId]
      );

      const savedNames = rows.map((r) => r.ingredient_name);
      
      // PROVE NO INGREDIENT DROPPED:
      assert.equal(rows.length, 4, "Must contain exactly 4 size ingredients");
      assert(savedNames.includes("Matcha Powder"), "Matcha Powder must be present");
      assert(savedNames.includes("Fresh Milk"), "Fresh Milk must be present");
      assert(savedNames.includes("12oz Paper Cup"), "12oz Paper Cup must be present");
      assert(savedNames.includes("Peanut Butter Cup"), "Peanut Butter Cup must NOT be dropped!");

      // PROVE NO EXTRA CUP INJECTED:
      const cupRows = rows.filter((r) => r.ingredient_name.toLowerCase().includes("cup"));
      assert.equal(cupRows.length, 2, "Only the 2 sent cup-named items must exist (12oz Paper Cup and Peanut Butter Cup)");
    } finally {
      await connection.rollback();
      connection.release();
    }
  });

  it("TEST 2 (Step 3a): Unknown or typo category must be rejected with HTTP 400", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const invalidPayload = {
        name: "Test Burger",
        category: "TypoNonExistentCategory_XYZ",
        price: "50.00",
        description: "Test description",
        sizes: [{ label: "Regular", price: 50, ingredients: [] }],
        ingredients: [],
      };

      await assert.rejects(
        async () => {
          await saveProduct(connection, invalidPayload);
        },
        (err) => {
          return err.status === 400 && /does not exist/i.test(err.message);
        },
        "Must throw HTTP 400 when category does not exist"
      );
    } finally {
      await connection.rollback();
      connection.release();
    }
  });

  it("TEST 3 (Step 3a): quantityUsed exceeding 100,000 must be rejected with HTTP 400", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const excessiveQuantityPayload = {
        name: "Excessive Item",
        category: "Foods / Snacks",
        price: "50.00",
        description: "Test description",
        sizes: [{ label: "Regular", price: 50, ingredients: [{ name: "Sugar", quantityUsed: 150000, unit: "g", stockUnit: "g" }] }],
        ingredients: [{ name: "Sugar", quantityUsed: 150000, unit: "g", stockUnit: "g" }],
      };

      await assert.rejects(
        async () => {
          await saveProduct(connection, excessiveQuantityPayload);
        },
        (err) => {
          return err.status === 400 && /100,000/i.test(err.message);
        },
        "Must throw HTTP 400 when quantityUsed > 100,000"
      );
    } finally {
      await connection.rollback();
      connection.release();
    }
  });

  it("TEST 4 (Step 3): Logged-out GET /menu (includeInventory=false) does NOT return recipes or inventoryItemId; authenticated returns them", async () => {
    // 1. Logged-out customer view:
    const publicProducts = await listProducts(false, false);
    for (const product of publicProducts) {
      assert.deepEqual(product.ingredients, [], "Public product must not leak ingredients");
      for (const size of product.sizes || []) {
        assert.deepEqual(size.ingredients, [], "Public product size must not leak size ingredients");
      }
      for (const addon of product.addons || []) {
        assert.equal(addon.inventoryItemId, undefined, "Public addon must not leak inventoryItemId");
      }
    }

    // 2. Authenticated staff/admin view:
    const authProducts = await listProducts(true, true);
    // If any product has ingredients in DB, authenticated view must retain them
    const authWithIngredients = authProducts.find((p) => p.sizes.some((s) => s.ingredients && s.ingredients.length > 0));
    if (authWithIngredients) {
      const authSize = authWithIngredients.sizes.find((s) => s.ingredients.length > 0);
      assert(authSize.ingredients[0].name, "Authenticated view must preserve ingredient names");
    }
  });

  it("TEST 5 (Step 5): Unknown ingredient in saveProduct must be rejected with HTTP 400", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const invalidIngredientPayload = {
        name: "Test Phantom Recipe",
        category: "Foods / Snacks",
        price: "75.00",
        description: "Test description",
        sizes: [
          {
            label: "Regular",
            price: 75,
            ingredients: [{ name: "CompletelyFakeNonExistentIngredient_XYZ", quantityUsed: 10, unit: "g", stockUnit: "g" }],
          },
        ],
        ingredients: [{ name: "CompletelyFakeNonExistentIngredient_XYZ", quantityUsed: 10, unit: "g", stockUnit: "g" }],
      };

      await assert.rejects(
        async () => {
          await saveProduct(connection, invalidIngredientPayload);
        },
        (err) => {
          return err.status === 400 && /does not exist/i.test(err.message);
        },
        "Must throw HTTP 400 when ingredient does not exist in inventory"
      );
    } finally {
      await connection.rollback();
      connection.release();
    }
  });

  it("TEST 6 (Step 6): Drink category without cup in any size must be rejected with HTTP 400", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        "INSERT INTO menu_categories (name, operational_family) VALUES ('Test Drinks', 'drink') ON DUPLICATE KEY UPDATE operational_family = 'drink'"
      );
      await connection.execute("INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('Matcha Powder', 'Ingredients', 500, 'g') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");

      const drinkWithoutCupPayload = {
        name: "Cupless Matcha",
        category: "Test Drinks",
        price: "85.00",
        description: "Drink missing a cup",
        sizes: [
          {
            label: "Regular",
            price: 85,
            ingredients: [
              { name: "Matcha Powder", quantityUsed: 15, unit: "g", stockUnit: "g" },
            ],
          },
        ],
        ingredients: [
          { name: "Matcha Powder", quantityUsed: 15, unit: "g", stockUnit: "g" },
        ],
      };

      await assert.rejects(
        async () => {
          await saveProduct(connection, drinkWithoutCupPayload);
        },
        (err) => {
          return err.status === 400 && /Every drink size must have a cup selected from Inventory/i.test(err.message);
        },
        "Must throw HTTP 400 when drink size is missing a cup"
      );
    } finally {
      await connection.rollback();
      connection.release();
    }
  });

  it("TEST 7 (Step 6): Non-cup ingredient with 'cup' in name (e.g. Peanut Butter Cup) does NOT satisfy drink cup check", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        "INSERT INTO menu_categories (name, operational_family) VALUES ('Test Drinks', 'drink') ON DUPLICATE KEY UPDATE operational_family = 'drink'"
      );
      await connection.execute("INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('Peanut Butter Cup', 'Ingredients', 50, 'pcs') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");

      const fakeCupPayload = {
        name: "PB Cup Shake",
        category: "Test Drinks",
        price: "90.00",
        description: "Contains peanut butter cup candy but no actual cup container",
        sizes: [
          {
            label: "Regular",
            price: 90,
            ingredients: [
              { name: "Peanut Butter Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
            ],
          },
        ],
        ingredients: [
          { name: "Peanut Butter Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
        ],
      };

      await assert.rejects(
        async () => {
          await saveProduct(connection, fakeCupPayload);
        },
        (err) => {
          return err.status === 400 && /Every drink size must have a cup selected from Inventory/i.test(err.message);
        },
        "Must throw HTTP 400 because Peanut Butter Cup is not in a cup category"
      );
    } finally {
      await connection.rollback();
      connection.release();
    }
  });

  it("TEST 8 (Step 6): Non-drink category (e.g. Foods / Snacks) saves successfully without any cup", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.execute(
        "INSERT INTO menu_categories (name, operational_family) VALUES ('Foods / Snacks', 'general') ON DUPLICATE KEY UPDATE operational_family = 'general'"
      );
      await connection.execute("INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('Burger Bun', 'Burger', 100, 'pcs') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");
      await connection.execute("INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('PATTY', 'Burger', 100, 'pcs') ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)");

      const burgerPayload = {
        name: "Classic Cheeseburger",
        category: "Foods / Snacks",
        price: "60.00",
        description: "Savory beef burger",
        sizes: [
          {
            label: "Regular",
            price: 60,
            ingredients: [
              { name: "Burger Bun", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
              { name: "PATTY", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
            ],
          },
        ],
        ingredients: [
          { name: "Burger Bun", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
          { name: "PATTY", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
        ],
      };

      const productId = await saveProduct(connection, burgerPayload);
      assert(productId > 0, "Burger must save without any cup");
    } finally {
      await connection.rollback();
      connection.release();
    }
  });
});
