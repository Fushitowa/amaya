import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { saveProduct, listProducts } from "../api/src/routes/menu.js";
import { selectRecipe } from "../api/src/routes/orders.js";
import { toInventoryQuantity } from "../api/src/utils/inventoryUnits.js";

describe("Tala & Kathie End-to-End Suite: Menu & Inventory Order Integration (Step 8)", () => {
  after(async () => {
    await pool.end();
  });

  it("Full E2E Cycle: Drink with explicit cup vs Snack without cup, order deduction, and recipe protection", async () => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. SETUP: Categories
      const [drinkCatResult] = await connection.execute(
        "INSERT INTO menu_categories (name, operational_family) VALUES ('E2E Drinks', 'drink') ON DUPLICATE KEY UPDATE operational_family = 'drink', id = LAST_INSERT_ID(id)"
      );
      const [snackCatResult] = await connection.execute(
        "INSERT INTO menu_categories (name, operational_family) VALUES ('E2E Snacks', 'general') ON DUPLICATE KEY UPDATE operational_family = 'general', id = LAST_INSERT_ID(id)"
      );

      // 2. SETUP: Inventory items
      const [cup16Result] = await connection.execute(
        "INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('E2E 16oz Cold Cup', 'Cups & Lids', 100, 'pcs') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
      );
      const cup16Id = cup16Result.insertId;

      const [cup22Result] = await connection.execute(
        "INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('E2E 22oz Cold Cup', 'Cups & Lids', 100, 'pcs') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
      );
      const cup22Id = cup22Result.insertId;

      const [teaResult] = await connection.execute(
        "INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('E2E Green Tea Powder', 'Ingredients', 500, 'g') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
      );
      const teaId = teaResult.insertId;

      const [bunResult] = await connection.execute(
        "INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('E2E Brioche Bun', 'Burger', 50, 'pcs') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
      );
      const bunId = bunResult.insertId;

      const [pattyResult] = await connection.execute(
        "INSERT INTO inventory_items (name, category, quantity, unit) VALUES ('E2E Beef Patty', 'Burger', 50, 'pcs') ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)"
      );
      const pattyId = pattyResult.insertId;

      // 3. SAVE DRINK PRODUCT: 2 sizes with distinct cups
      const drinkPayload = {
        name: "E2E Artisan Green Tea",
        category: "E2E Drinks",
        price: "90.00",
        description: "Freshly brewed artisan green tea",
        available: true,
        sizes: [
          {
            label: "Medium (16oz)",
            price: 90,
            ingredients: [
              { inventoryItemId: cup16Id, name: "E2E 16oz Cold Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
              { inventoryItemId: teaId, name: "E2E Green Tea Powder", quantityUsed: 15, unit: "g", stockUnit: "g" },
            ],
          },
          {
            label: "Large (22oz)",
            price: 110,
            ingredients: [
              { inventoryItemId: cup22Id, name: "E2E 22oz Cold Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
              { inventoryItemId: teaId, name: "E2E Green Tea Powder", quantityUsed: 22, unit: "g", stockUnit: "g" },
            ],
          },
        ],
        ingredients: [
          { inventoryItemId: cup16Id, name: "E2E 16oz Cold Cup", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
          { inventoryItemId: teaId, name: "E2E Green Tea Powder", quantityUsed: 15, unit: "g", stockUnit: "g" },
        ],
      };

      const drinkProductId = await saveProduct(connection, drinkPayload);
      assert(drinkProductId > 0, "Drink product must be created");

      // Verify drink sizes and ingredients in database
      const [savedSizes] = await connection.execute(
        "SELECT id, label, price FROM product_sizes WHERE product_id = ? ORDER BY display_order",
        [drinkProductId]
      );
      assert.equal(savedSizes.length, 2, "Must have exactly 2 sizes");

      const size16 = savedSizes.find((s) => s.label.includes("16oz"));
      const size22 = savedSizes.find((s) => s.label.includes("22oz"));
      assert(size16 && size22, "Both 16oz and 22oz sizes must exist");

      const [size16Ingredients] = await connection.execute(
        "SELECT inventory_item_id, quantity_used FROM product_size_ingredients WHERE product_size_id = ?",
        [size16.id]
      );
      const [size22Ingredients] = await connection.execute(
        "SELECT inventory_item_id, quantity_used FROM product_size_ingredients WHERE product_size_id = ?",
        [size22.id]
      );

      // Verify explicit cup IDs are assigned correctly
      const cup16Assigned = size16Ingredients.find((i) => Number(i.inventory_item_id) === cup16Id);
      const cup22Assigned = size22Ingredients.find((i) => Number(i.inventory_item_id) === cup22Id);
      assert(cup16Assigned, "16oz size must have 16oz Cold Cup assigned");
      assert(cup22Assigned, "22oz size must have 22oz Cold Cup assigned");
      assert.equal(Number(cup16Assigned.quantity_used), 1);
      assert.equal(Number(cup22Assigned.quantity_used), 1);

      // 4. SAVE SNACK PRODUCT: 1 size, NO cup
      const snackPayload = {
        name: "E2E Classic Snack Burger",
        category: "E2E Snacks",
        price: "65.00",
        description: "Juicy burger with brioche bun",
        available: true,
        sizes: [
          {
            label: "Regular",
            price: 65,
            ingredients: [
              { inventoryItemId: bunId, name: "E2E Brioche Bun", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
              { inventoryItemId: pattyId, name: "E2E Beef Patty", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
            ],
          },
        ],
        ingredients: [
          { inventoryItemId: bunId, name: "E2E Brioche Bun", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
          { inventoryItemId: pattyId, name: "E2E Beef Patty", quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
        ],
      };

      const snackProductId = await saveProduct(connection, snackPayload);
      assert(snackProductId > 0, "Snack product must be created");

      const [snackSizes] = await connection.execute(
        "SELECT id, label FROM product_sizes WHERE product_id = ?",
        [snackProductId]
      );
      assert.equal(snackSizes.length, 1);
      const [snackIngredients] = await connection.execute(
        "SELECT inventory_item_id, quantity_used FROM product_size_ingredients WHERE product_size_id = ?",
        [snackSizes[0].id]
      );
      assert.equal(snackIngredients.length, 2, "Snack must have only 2 ingredients");
      const snackItemIds = snackIngredients.map((i) => Number(i.inventory_item_id));
      assert(snackItemIds.includes(bunId), "Brioche bun must be in snack recipe");
      assert(snackItemIds.includes(pattyId), "Beef patty must be in snack recipe");
      assert(!snackItemIds.includes(cup16Id) && !snackItemIds.includes(cup22Id), "Snack must NOT have any cup assigned");

      // 5. SIMULATE POS ORDER DEDUCTION FLOW
      // Order: 2x Artisan Green Tea (Medium 16oz), 1x Classic Snack Burger (Regular)
      const orderLines = [
        { productId: drinkProductId, sizeId: size16.id, quantity: 2 },
        { productId: snackProductId, sizeId: snackSizes[0].id, quantity: 1 },
      ];

      // Fetch size recipes as orders.js does:
      const selectedSizeIds = orderLines.map((l) => l.sizeId);
      const [orderRecipeRows] = await connection.execute(
        `SELECT psi.product_size_id, psi.inventory_item_id, psi.quantity_used, psi.unit AS recipe_unit,
                i.name AS inventory_name, i.unit AS inventory_unit
           FROM product_size_ingredients psi
           JOIN inventory_items i ON i.id = psi.inventory_item_id
          WHERE psi.product_size_id IN (${selectedSizeIds.map(() => "?").join(",")})`,
        selectedSizeIds
      );

      const recipesBySize = new Map();
      orderRecipeRows.forEach((ingredient) => {
        const sizeId = Number(ingredient.product_size_id);
        const entries = recipesBySize.get(sizeId) || [];
        entries.push({
          inventoryItemId: Number(ingredient.inventory_item_id),
          inventoryName: ingredient.inventory_name,
          unit: ingredient.inventory_unit,
          quantityPerServing: toInventoryQuantity(ingredient.quantity_used, ingredient.recipe_unit, ingredient.inventory_unit),
        });
        recipesBySize.set(sizeId, entries);
      });

      // Aggregate required inventory per order
      const requiredInventory = new Map();
      for (const line of orderLines) {
        const activeRecipe = selectRecipe(recipesBySize.get(line.sizeId) || [], []);
        for (const ingredient of activeRecipe) {
          const prev = requiredInventory.get(ingredient.inventoryItemId) || 0;
          requiredInventory.set(ingredient.inventoryItemId, prev + ingredient.quantityPerServing * line.quantity);
        }
      }

      // Assertions on deducted quantities:
      assert.equal(requiredInventory.get(cup16Id), 2, "Exact 2 pcs of 16oz cup must be deducted for 2 drinks");
      assert.equal(requiredInventory.get(cup22Id), undefined, "22oz cup must NOT be deducted at all");
      assert.equal(requiredInventory.get(teaId), 30, "30g (15g * 2) of Green Tea powder must be deducted");
      assert.equal(requiredInventory.get(bunId), 1, "1 Brioche bun must be deducted for burger");
      assert.equal(requiredInventory.get(pattyId), 1, "1 Beef patty must be deducted for burger");

      // Execute inventory deductions in transaction
      for (const [itemId, deductQty] of requiredInventory.entries()) {
        await connection.execute(
          "UPDATE inventory_items SET quantity = quantity - ? WHERE id = ?",
          [deductQty, itemId]
        );
      }

      // Verify updated inventory quantities:
      const [[cup16After]] = await connection.execute("SELECT quantity FROM inventory_items WHERE id = ?", [cup16Id]);
      const [[cup22After]] = await connection.execute("SELECT quantity FROM inventory_items WHERE id = ?", [cup22Id]);
      const [[bunAfter]] = await connection.execute("SELECT quantity FROM inventory_items WHERE id = ?", [bunId]);

      assert.equal(Number(cup16After.quantity), 98, "16oz cup stock should decrease from 100 to 98");
      assert.equal(Number(cup22After.quantity), 100, "22oz cup stock must remain unchanged at 100");
      assert.equal(Number(bunAfter.quantity), 49, "Brioche bun stock should decrease from 50 to 49");

      // 6. PUBLIC RECIPE PROTECTION (Zero Data Leak to Logged-Out Users)
      const publicCatalog = await listProducts(false, false);
      for (const p of publicCatalog) {
        assert.deepEqual(p.ingredients, [], `Public product ${p.name} must have empty ingredients`);
        for (const s of p.sizes || []) {
          assert.deepEqual(s.ingredients, [], `Public product size ${s.label} must have empty ingredients`);
        }
      }
    } finally {
      // Clean rollback ensures 0 pollution of real store database
      await connection.rollback();
      connection.release();
    }
  });
});
