import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { saveProduct } from "../api/src/routes/menu.js";

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
});
