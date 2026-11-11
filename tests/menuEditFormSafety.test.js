import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_TARGET_FOOD_COST,
  buildSafeSizeQtyMap,
  readSizeQtyValue,
  writeSizeQtyValue,
  computeMenuItemCostSummary,
  normalizeTargetFoodCost,
  safeItemName,
  safeToFixed,
  findInventoryItemInList,
  convertRecipeAmount,
  defaultSizeFactor,
  scaleIngredientAmount,
} from "../src/utils/menuCosting.js";

/**
 * ============================================================================
 * TALA TEST SUITE: MENU EDIT FORM SAFETY & ZERO-CRASH VERIFICATION
 * ============================================================================
 * Purpose: Guard AdminMenuManagement.jsx against white-screen runtime crashes
 * when clicking `•••` (openEditForm) on product cards.
 *
 * Verifies:
 * 1. Safe form population on null/missing/legacy products
 * 2. Safe lookups against inventory items with missing/undefined `item` or `name`
 * 3. Safe sizeCosting calculations and .toFixed(2) protection via src/utils/menuCosting.js
 * 4. Exact vulnerability mapping of AdminMenuManagement.jsx
 * 5. Shared frontend costing parity, single-price/1-size/untrimmed-label & prototype safety
 * ============================================================================
 */

// --- CANONICAL SAFE HELPERS (DELEGATED TO SHARED PRODUCTION UTILITY) ---

export { convertRecipeAmount, defaultSizeFactor, scaleIngredientAmount, safeItemName, safeToFixed };

export const findInventoryItem = findInventoryItemInList;

export const isCupIngredient = (ing, inventory = []) => {
  if (!ing) return false;
  const name = String(ing.name || ing.item || "").trim().toLowerCase();
  const targetId = ing.inventoryItemId != null ? Number(ing.inventoryItemId) : null;
  const invItem = (Array.isArray(inventory) ? inventory : []).find((entry) => {
    if (!entry) return false;
    if (targetId !== null && Number(entry.id) === targetId) return true;
    const entryName = safeItemName(entry).toLowerCase();
    return Boolean(entryName && entryName === name);
  });
  return Boolean(
    invItem?.isCupCategory ||
      invItem?.is_cup_category ||
      invItem?.category === "Cups" ||
      invItem?.category === "Cups & Lids"
  );
};

export const populateFormValues = (product, inventory = []) => {
  const safeProduct = product || {};
  const safeInventory = Array.isArray(inventory) ? inventory : [];

  const rawSizes = Array.isArray(safeProduct.sizes) ? safeProduct.sizes : [];
  const rawIngredients = Array.isArray(safeProduct.ingredients) ? safeProduct.ingredients.filter(Boolean) : [];
  const rawAddons = Array.isArray(safeProduct.addons) ? safeProduct.addons.filter(Boolean) : [];

  const sizes = rawSizes.filter(Boolean).map((size, idx) => {
    const sizeIngredients = Array.isArray(size.ingredients) ? size.ingredients.filter(Boolean) : [];
    const sizeCup = sizeIngredients.find((ing) => isCupIngredient(ing, safeInventory));
    return {
      label: String(size.label || `Size ${idx + 1}`),
      price: size.price != null && !Number.isNaN(Number(size.price)) ? String(size.price) : "",
      factor: size.factor ?? defaultSizeFactor(null, idx),
      cupId: sizeCup && sizeCup.inventoryItemId != null ? Number(sizeCup.inventoryItemId) : null,
    };
  });

  const mergedIngredients = [
    ...rawIngredients,
    ...rawSizes
      .flatMap((size) => (Array.isArray(size?.ingredients) ? size.ingredients.filter(Boolean) : []))
      .filter((entry, index, all) => {
        if (typeof entry === "string") return false;
        if (!entry || entry.inventoryItemId == null) return false;
        const entryId = Number(entry.inventoryItemId);
        const existsInBase = rawIngredients.some(
          (base) => typeof base !== "string" && base && Number(base.inventoryItemId) === entryId
        );
        const isFirstOccurrence =
          all.findIndex((other) => other && Number(other.inventoryItemId) === entryId) === index;
        return !existsInBase && isFirstOccurrence;
      }),
  ];

  const ingredients = mergedIngredients.map((ingredient) => {
    if (typeof ingredient === "string") {
      const invItem = findInventoryItem(safeInventory, ingredient);
      return {
        name: invItem ? safeItemName(invItem) : ingredient,
        unit: invItem?.unit || "pcs",
        stockUnit: invItem?.unit || "pcs",
        quantityUsed: "",
        quantityBySize: buildSafeSizeQtyMap(),
      };
    }
    const invId = ingredient?.inventoryItemId != null ? Number(ingredient.inventoryItemId) : null;
    const invItem = findInventoryItem(safeInventory, ingredient?.name, invId);
    const quantityBySize = buildSafeSizeQtyMap(
      sizes.map((size) => {
        const rawSizeObj = rawSizes.find((s) => s?.label === size.label);
        const sizedIngredient = Array.isArray(rawSizeObj?.ingredients)
          ? rawSizeObj.ingredients.find((entry) => entry && Number(entry.inventoryItemId) === invId)
          : null;
        return [
          size.label,
          sizedIngredient && sizedIngredient.quantityUsed != null ? String(sizedIngredient.quantityUsed) : "0",
        ];
      })
    );
    return {
      ...ingredient,
      name: ingredient.name || safeItemName(invItem) || "",
      unit: ingredient.unit || invItem?.unit || "pcs",
      stockUnit: ingredient.stockUnit || invItem?.unit || ingredient.unit || "pcs",
      quantityUsed: ingredient.quantityUsed == null ? "" : String(ingredient.quantityUsed),
      quantityBySize,
    };
  });

  const addons = rawAddons.map((addon) => {
    const invId = addon?.inventoryItemId != null ? Number(addon.inventoryItemId) : null;
    const invItem = findInventoryItem(safeInventory, addon?.label, invId);
    return {
      ...addon,
      label: String(addon?.label || ""),
      price: addon?.price != null ? String(addon.price) : "",
      quantityUsed: addon?.quantityUsed == null ? 1 : addon.quantityUsed,
      unit: addon?.unit || invItem?.unit || "pcs",
      stockUnit: addon?.stockUnit || invItem?.unit || addon?.unit || "pcs",
    };
  });

  return {
    name: String(safeProduct.name || ""),
    price: String(safeProduct.price || "").replace(/[^0-9.]/g, ""),
    stock: safeProduct.stock != null ? String(safeProduct.stock) : "",
    description: safeProduct.description != null ? String(safeProduct.description) : "",
    category: safeProduct.category != null ? String(safeProduct.category) : "",
    image: safeProduct.image != null ? String(safeProduct.image) : "",
    sizes,
    ingredients,
    addons,
    available: safeProduct.available !== false,
  };
};

export const computeSafeSizeCosting = (
  sizeLabel,
  rawSizePrice,
  formValues = {},
  inventory = [],
  targetFoodCost = DEFAULT_TARGET_FOOD_COST,
) => {
  const formPrice = Number(formValues?.price) || 0;
  const numericPrice =
    rawSizePrice !== "" && rawSizePrice !== null && rawSizePrice !== undefined && !Number.isNaN(Number(rawSizePrice))
      ? Number(rawSizePrice)
      : formPrice;

  const sizes = Array.isArray(formValues?.sizes) ? formValues.sizes.filter(Boolean) : [];
  const matchedSize = sizeLabel ? sizes.find((s) => s?.label === sizeLabel) : null;
  const sizeFactor = matchedSize ? defaultSizeFactor(matchedSize.factor, 0) : 1.0;

  const summary = computeMenuItemCostSummary({
    sellingPrice: numericPrice,
    directCostPrice: sizes.length === 0 ? formValues?.costPrice : 0,
    sizeLabel,
    sizeFactor,
    ingredients: formValues?.ingredients || [],
    inventory,
    targetFoodCost,
  });

  return {
    ...summary,
    costFormatted: safeToFixed(summary.cost, 2),
    profitFormatted: safeToFixed(summary.grossProfit ?? 0, 2),
    marginFormatted: summary.margin != null ? `${safeToFixed(summary.margin, 1)}%` : "—",
  };
};

// --- TEST SUITES ---

describe("Tala Test Suite: Menu Edit Form Safety & Zero-Crash Verification", () => {
  describe("SUITE 1: Form Population Safety & Null-Tolerant Defaults", () => {
    it("TEST 1.1: Product with null fields (ingredients, sizes, addons, description, price) populates safely without throwing", () => {
      const hostileProduct = {
        id: 42,
        name: "Minimalist Snack",
        price: null,
        stock: null,
        description: null,
        category: null,
        image: null,
        sizes: null,
        ingredients: null,
        addons: null,
        available: true,
      };

      assert.doesNotThrow(() => {
        const formValues = populateFormValues(hostileProduct, []);
        assert.equal(formValues.name, "Minimalist Snack");
        assert.equal(formValues.price, "");
        assert.equal(formValues.stock, "");
        assert.equal(formValues.description, "");
        assert.equal(formValues.category, "");
        assert.equal(formValues.image, "");
        assert.deepEqual(formValues.sizes, []);
        assert.deepEqual(formValues.ingredients, []);
        assert.deepEqual(formValues.addons, []);
        assert.equal(formValues.available, true);
      });
    });

    it("TEST 1.2: Product with undefined fields populates safe default empty structures", () => {
      const undefinedProduct = {
        id: 99,
      };

      const formValues = populateFormValues(undefinedProduct, []);
      assert.equal(formValues.name, "");
      assert.equal(formValues.price, "");
      assert.equal(formValues.stock, "");
      assert.equal(formValues.description, "");
      assert.deepEqual(formValues.sizes, []);
      assert.deepEqual(formValues.ingredients, []);
      assert.deepEqual(formValues.addons, []);
      assert.equal(formValues.available, true);
    });

    it("TEST 1.3: Product with legacy string ingredients populates without crashing", () => {
      const legacyProduct = {
        id: 10,
        name: "Classic Milk Tea",
        price: "120.00",
        ingredients: ["Black Tea Leaves", "Fresh Milk"],
      };

      const mockInventory = [
        { id: 1, item: "Black Tea Leaves", unit: "g" },
        { id: 2, name: "Fresh Milk", unit: "ml" }, // Note: uses 'name' instead of 'item'
      ];

      const formValues = populateFormValues(legacyProduct, mockInventory);
      assert.equal(formValues.ingredients.length, 2);
      assert.equal(formValues.ingredients[0].name, "Black Tea Leaves");
      assert.equal(formValues.ingredients[0].unit, "g");
      assert.equal(formValues.ingredients[1].name, "Fresh Milk");
      assert.equal(formValues.ingredients[1].unit, "ml");
    });

    it("TEST 1.4: Malformed or null entries inside sizes and ingredients arrays are gracefully filtered", () => {
      const corruptProduct = {
        id: 77,
        name: "Glitch Item",
        sizes: [null, { label: "Regular", price: 50, ingredients: [null] }, undefined],
        ingredients: [null, { inventoryItemId: 5, name: "Sugar", quantityUsed: 10 }, undefined],
      };

      assert.doesNotThrow(() => {
        const formValues = populateFormValues(corruptProduct, []);
        assert.equal(formValues.sizes.length, 1);
        assert.equal(formValues.sizes[0].label, "Regular");
        assert.equal(formValues.ingredients.length, 1);
        assert.equal(formValues.ingredients[0].name, "Sugar");
      });
    });

    it("TEST 1.5: Size with null/undefined price produces empty string price instead of 'null' or 'undefined'", () => {
      const productWithNullSizePrice = {
        id: 12,
        name: "Coffee",
        sizes: [{ label: "16oz", price: null }],
      };

      const formValues = populateFormValues(productWithNullSizePrice, []);
      assert.equal(formValues.sizes[0].price, "", "Price must be empty string, NOT string 'null'");
      assert.notEqual(formValues.sizes[0].price, "null");
      assert.notEqual(formValues.sizes[0].price, "undefined");
    });
  });

  describe("SUITE 2: Zero-Crash Inventory Lookups & .toLowerCase() Guarding", () => {
    it("TEST 2.1: Demonstrates that unprotected entry.item.toLowerCase() throws TypeError when item is undefined", () => {
      const badInventoryItem = { id: 1, name: "Matcha Powder" }; // Missing .item!

      assert.throws(
        () => {
          // Unprotected pattern found in unhardened code:
          return badInventoryItem.item.toLowerCase() === "matcha powder";
        },
        {
          name: "TypeError",
          message: /toLowerCase/,
        },
        "Must confirm unprotected property access causes the white-screen TypeError"
      );
    });

    it("TEST 2.2: Hardened findInventoryItem supports items with only .name without throwing", () => {
      const mockInventory = [
        { id: 1, name: "Matcha Powder", unit: "g" },
        { id: 2, item: "Fresh Milk", unit: "ml" },
      ];

      const found = findInventoryItem(mockInventory, "Matcha Powder");
      assert.ok(found, "Item should be found by .name");
      assert.equal(found.id, 1);
      assert.equal(safeItemName(found), "Matcha Powder");
    });

    it("TEST 2.3: Hardened findInventoryItem survives null, undefined, and empty objects in inventory array", () => {
      const messyInventory = [
        null,
        undefined,
        {},
        { id: 99 },
        { id: 100, item: null, name: null },
        { id: 101, item: "U-Cup 16oz", unit: "pcs" },
      ];

      assert.doesNotThrow(() => {
        const found = findInventoryItem(messyInventory, "U-Cup 16oz");
        assert.ok(found);
        assert.equal(found.id, 101);

        const notFound = findInventoryItem(messyInventory, "Nonexistent");
        assert.equal(notFound, undefined);
      });
    });

    it("TEST 2.4: Query with null, undefined, or whitespace-padded string does not throw", () => {
      const mockInventory = [{ id: 1, item: "Brown Sugar", unit: "g" }];

      assert.doesNotThrow(() => {
        assert.equal(findInventoryItem(mockInventory, null), undefined);
        assert.equal(findInventoryItem(mockInventory, undefined), undefined);
        assert.equal(findInventoryItem(mockInventory, ""), undefined);
        assert.equal(findInventoryItem(mockInventory, "   "), undefined);
        assert.equal(findInventoryItem(mockInventory, "  brown sugar  ")?.id, 1);
      });
    });

    it("TEST 2.5: isCupIngredient never throws even when inventory items lack .item or have null categories", () => {
      const messyInventory = [
        { id: 10, name: "16oz Cup", category: "Cups & Lids", is_cup_category: true },
        { id: 11, item: undefined, name: "22oz Cup", category: "Cups", isCupCategory: true },
        { id: 12, item: null, name: "Straws", category: null },
        null,
      ];

      assert.doesNotThrow(() => {
        assert.equal(isCupIngredient({ name: "16oz Cup", inventoryItemId: 10 }, messyInventory), true);
        assert.equal(isCupIngredient({ name: "22oz Cup", inventoryItemId: 11 }, messyInventory), true);
        assert.equal(isCupIngredient({ name: "Straws", inventoryItemId: 12 }, messyInventory), false);
        assert.equal(isCupIngredient(null, messyInventory), false);
        assert.equal(isCupIngredient({ name: "Ghost Cup" }, messyInventory), false);
      });
    });
  });

  describe("SUITE 3: sizeCosting Robustness & .toFixed(2) Protection", () => {
    it("TEST 3.1: Zero ingredients returns cost 0 and formats to '0.00' without crashing", () => {
      const formValues = {
        price: "100.00",
        sizes: [{ label: "Regular", price: "100.00" }],
        ingredients: [],
      };

      const result = computeSafeSizeCosting("Regular", "100.00", formValues, []);
      assert.equal(result.cost, 0);
      assert.equal(result.costComplete, false);
      assert.equal(result.costFormatted, "0.00");
      assert.equal(result.profitFormatted, "100.00");
      assert.equal(result.marginFormatted, "100.0%");
    });

    it("TEST 3.2: Missing/unmatched ingredients or zero unit cost flags incomplete without throwing", () => {
      const formValues = {
        price: "80.00",
        sizes: [{ label: "Regular", price: "80.00" }],
        ingredients: [
          { name: "Mysterious Powder", quantityUsed: "10", unit: "g" },
          { name: "Zero Cost Water", quantityUsed: "100", unit: "ml" },
        ],
      };

      const inventory = [
        { id: 1, item: "Zero Cost Water", unit: "ml", unitCost: 0 },
        // "Mysterious Powder" is not in inventory
      ];

      assert.doesNotThrow(() => {
        const result = computeSafeSizeCosting("Regular", "80.00", formValues, inventory);
        assert.equal(result.cost, 0);
        assert.equal(result.costComplete, false);
        assert.equal(result.costFormatted, "0.00");
        assert.equal(result.suggestedPrice, null);
      });
    });

    it("TEST 3.3: Null or non-numeric prices do not generate NaN in margin or profit", () => {
      const formValues = {
        price: "",
        sizes: [{ label: "Regular", price: null }],
        ingredients: [{ name: "Sugar", quantityUsed: "5", unit: "g" }],
      };

      const inventory = [{ id: 1, item: "Sugar", unit: "g", unitCost: 0.1 }];

      const result = computeSafeSizeCosting("Regular", null, formValues, inventory);
      assert.equal(result.cost, 0.5);
      assert.equal(result.costFormatted, "0.50");
      assert.equal(result.grossProfit, null);
      assert.equal(result.margin, null);
      assert.equal(result.profitFormatted, "0.00");
      assert.equal(result.marginFormatted, "—");
    });

    it("TEST 3.4: safeToFixed protects against undefined, null, NaN, and Infinity", () => {
      assert.equal(safeToFixed(undefined, 2, "0.00"), "0.00");
      assert.equal(safeToFixed(null, 2, "0.00"), "0.00");
      assert.equal(safeToFixed(NaN, 2, "0.00"), "0.00");
      assert.equal(safeToFixed(Infinity, 2, "0.00"), "0.00");
      assert.equal(safeToFixed(-Infinity, 2, "0.00"), "0.00");
      assert.equal(safeToFixed(12.3456, 2), "12.35");
      assert.equal(safeToFixed(0, 2), "0.00");
    });

    it("TEST 3.5: All JSX rendering expressions evaluate cleanly without exceptions", () => {
      const mockCosting = computeSafeSizeCosting("Regular", "", { price: "", ingredients: [] }, []);

      // Replicates AdminMenuManagement.jsx lines 1786-1790
      assert.doesNotThrow(() => {
        const cogsText = `₱${mockCosting.cost.toFixed(2)}`;
        const profitText = `₱${(mockCosting.grossProfit ?? 0).toFixed(2)}`;
        const marginText = `Margin ${mockCosting.margin != null ? `${mockCosting.margin.toFixed(1)}%` : "—"}`;

        assert.equal(cogsText, "₱0.00");
        assert.equal(profitText, "₱0.00");
        assert.equal(marginText, "Margin —");
      });
    });
  });

  describe("SUITE 4: Full Edit-Form Click Simulation & Vulnerability Audit", () => {
    it("TEST 4.1: Simulates clicking '•••' on Markie's product card with chaotic database state", () => {
      const productUnderClick = {
        id: 501,
        name: "Signature Wintermelon Milk Tea",
        price: "110.00",
        stock: 0,
        description: null, // Legacy null description
        category: "Milk Tea",
        image: null,
        sizes: [
          {
            label: "Regular (16oz)",
            price: 110,
            factor: 1.0,
            ingredients: [
              { inventoryItemId: 201, name: "16oz U-Cup", quantityUsed: 1, unit: "pcs" },
              { inventoryItemId: 301, name: "Wintermelon Syrup", quantityUsed: 30, unit: "ml" },
            ],
          },
          {
            label: "Large (22oz)",
            price: 130,
            factor: 1.35,
            ingredients: [
              { inventoryItemId: 202, name: "22oz U-Cup", quantityUsed: 1, unit: "pcs" },
              { inventoryItemId: 301, name: "Wintermelon Syrup", quantityUsed: 40, unit: "ml" },
            ],
          },
        ],
        ingredients: [
          { inventoryItemId: 301, name: "Wintermelon Syrup", quantityUsed: 30, unit: "ml", unitCost: 0.25 },
        ],
        addons: [
          { label: "Boba Pearls", price: "15.00", inventoryItemId: 401, quantityUsed: 20, unit: "g" },
          { label: "Egg Pudding", price: "20.00", inventoryItemId: null, quantityUsed: 1, unit: "pcs" },
        ],
        available: true,
      };

      const realisticInventory = [
        { id: 201, name: "16oz U-Cup", category: "Cups & Lids", unit: "pcs", unitCost: 2.5, is_cup_category: true },
        // Note: 202 has item instead of name
        { id: 202, item: "22oz U-Cup", category: "Cups & Lids", unit: "pcs", unitCost: 3.2, is_cup_category: true },
        { id: 301, item: "Wintermelon Syrup", category: "Syrups", unit: "ml", unitCost: 0.25 },
        { id: 401, name: "Boba Pearls", category: "Toppings", unit: "g", unitCost: 0.15 },
        // Notice: Contains a corrupted inventory item that would kill unhardened loops:
        { id: 999, item: undefined, name: undefined },
      ];

      assert.doesNotThrow(() => {
        // Step 1: Click ••• and populate form
        const formValues = populateFormValues(productUnderClick, realisticInventory);

        assert.equal(formValues.name, "Signature Wintermelon Milk Tea");
        assert.equal(formValues.sizes.length, 2);
        assert.equal(formValues.sizes[0].cupId, 201);
        assert.equal(formValues.sizes[1].cupId, 202);
        assert.equal(formValues.description, "");

        // Step 2: Form renders and evaluates sizeCosting for each size
        for (const size of formValues.sizes) {
          const costing = computeSafeSizeCosting(size.label, size.price, formValues, realisticInventory);
          assert(Number.isFinite(costing.cost), "Cost must be a finite number");
          assert(costing.cost > 0, "Cost should reflect syrup and cup costs");
          assert(costing.costFormatted.includes("."), "Cost formatted must have decimals");
        }
      });
    });

    it("TEST 4.2: Audit scan of AdminMenuManagement.jsx locates all unguarded .toLowerCase() call sites", async () => {
      const filePath = path.resolve("src/pages/admin/AdminMenuManagement.jsx");
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const unguardedSites = [];
      lines.forEach((line, index) => {
        // Look for unguarded property reads before .toLowerCase()
        if (
          line.includes("entry.item.toLowerCase()") ||
          line.includes("addon.label.toLowerCase()") ||
          line.includes("chosenCup.item.toLowerCase()") ||
          line.includes("cup.item.toLowerCase()")
        ) {
          unguardedSites.push({
            lineNumber: index + 1,
            lineText: line.trim(),
          });
        }
      });

      // The test documents and asserts our static audit findings: ZERO unguarded sites remain
      assert.strictEqual(
        unguardedSites.length,
        0,
        `Expected 0 unguarded call sites after hardening, but found ${unguardedSites.length}: ${JSON.stringify(unguardedSites)}`
      );
    });
  });

  describe("SUITE 5: Shared Frontend Costing Parity, Single-Price Fallback & Prototype Safety", () => {
    const loadMenuCosting = () => import("../src/utils/menuCosting.js").catch(() => null);

    it("TEST 5.1: src/utils/menuCosting.js exports shared costing helpers, parameterizes targetFoodCost (0.30 vs 0.40), and enforces [0.10, 0.90] bounds", async () => {
      const menuCosting = await loadMenuCosting();
      assert.ok(menuCosting, "src/utils/menuCosting.js must exist and export shared costing helpers");
      assert.equal(typeof menuCosting.computeMenuItemCostSummary, "function");
      assert.equal(typeof menuCosting.buildSafeSizeQtyMap, "function");
      assert.equal(typeof menuCosting.readSizeQtyValue, "function");

      const inventory = [{ id: 1, item: "Milk", unit: "ml", unitCost: 0.12 }];
      const ingredients = [{ inventoryItemId: 1, name: "Milk", quantityUsed: "100", unit: "ml", stockUnit: "ml" }];

      const at30 = menuCosting.computeMenuItemCostSummary({
        sellingPrice: 50,
        ingredients,
        inventory,
        targetFoodCost: 0.3,
      });
      assert.equal(at30.cost, 12);
      assert.equal(at30.costComplete, true);
      assert.equal(at30.usedCount, 1);
      assert.equal(at30.suggestedPrice, 40);

      const at40 = menuCosting.computeMenuItemCostSummary({
        sellingPrice: 50,
        ingredients,
        inventory,
        targetFoodCost: 0.4,
      });
      assert.equal(at40.cost, 12);
      assert.equal(at40.suggestedPrice, 30);

      const outOfBounds = menuCosting.computeMenuItemCostSummary({
        sellingPrice: 50,
        ingredients,
        inventory,
        targetFoodCost: 0.05,
      });
      assert.equal(outOfBounds.suggestedPrice, 40, "Out-of-range targetFoodCost 0.05 must fall back to 0.30");
    });

    it("TEST 5.2: single-price (sizes = []) recipe costing and direct costPrice fallback match backend parity", async () => {
      const menuCosting = await loadMenuCosting();
      assert.ok(menuCosting, "src/utils/menuCosting.js must exist and export shared costing helpers");

      const directFallback = menuCosting.computeMenuItemCostSummary({
        sellingPrice: 60,
        directCostPrice: 24,
        ingredients: [],
        inventory: [],
        targetFoodCost: 0.4,
      });
      assert.equal(directFallback.usedCount, 0);
      assert.equal(directFallback.cost, 24);
      assert.equal(directFallback.costComplete, true);
      assert.equal(directFallback.costSource, "direct");
      assert.equal(directFallback.grossProfit, 36);
      assert.equal(directFallback.suggestedPrice, 60);

      const singleRecipe = menuCosting.computeMenuItemCostSummary({
        sellingPrice: 45,
        directCostPrice: 99,
        ingredients: [{ inventoryItemId: 2, name: "Bun", quantityUsed: "2", unit: "pcs", stockUnit: "pcs" }],
        inventory: [{ id: 2, name: "Bun", unit: "pcs", unitCost: 4.5 }],
        targetFoodCost: 0.3,
      });
      assert.equal(singleRecipe.usedCount, 1);
      assert.equal(singleRecipe.cost, 9);
      assert.equal(singleRecipe.costComplete, true);
      assert.equal(singleRecipe.costSource, "recipe");
      assert.equal(singleRecipe.suggestedPrice, 30);
    });

    it("TEST 5.3: all-zero ingredient quantity (usedCount === 0, no directCostPrice) reports costComplete: false", async () => {
      const menuCosting = await loadMenuCosting();
      assert.ok(menuCosting, "src/utils/menuCosting.js must exist and export shared costing helpers");

      const qMap = menuCosting.buildSafeSizeQtyMap([["Regular", "0"]]);
      const zeroSized = menuCosting.computeMenuItemCostSummary({
        sellingPrice: 80,
        directCostPrice: 0,
        sizeLabel: "Regular",
        ingredients: [
          {
            inventoryItemId: 3,
            name: "Sugar",
            quantityUsed: "10",
            quantityBySize: qMap,
            unit: "g",
            stockUnit: "g",
          },
        ],
        inventory: [{ id: 3, item: "Sugar", unit: "g", unitCost: 0.2 }],
        targetFoodCost: 0.3,
      });
      assert.equal(zeroSized.usedCount, 0);
      assert.equal(zeroSized.cost, 0);
      assert.equal(zeroSized.costComplete, false);
      assert.equal(zeroSized.suggestedPrice, null);
    });

    it("TEST 5.4: IEEE-754 ceil boundary (5.25 at 0.35 -> 15), grossProfit: null on price = 0, and .toFixed(4) line accumulation parity", async () => {
      const menuCosting = await loadMenuCosting();
      assert.ok(menuCosting, "src/utils/menuCosting.js must exist and export shared costing helpers");

      const ieeeResult = menuCosting.computeMenuItemCostSummary({
        sellingPrice: 0,
        ingredients: [{ inventoryItemId: 4, name: "Syrup", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" }],
        inventory: [{ id: 4, item: "Syrup", unit: "pcs", unitCost: 5.25 }],
        targetFoodCost: 0.35,
      });
      assert.equal(ieeeResult.cost, 5.25);
      assert.equal(ieeeResult.grossProfit, null, "Zero selling price must return grossProfit: null");
      assert.equal(ieeeResult.margin, null);
      assert.equal(
        ieeeResult.suggestedPrice,
        15,
        "5.25 at 0.35 target must suggest 15 (not IEEE-754 overshot 20)",
      );

      // .toFixed(4) line rounding parity: 0.001 * 1.664 = 0.001664 -> 0.0017 per line; 3 lines = 0.0051 -> 0.01 (vs unrounded 0.004992 -> 0.00)
      const tinyLines = menuCosting.computeMenuItemCostSummary({
        sellingPrice: 10,
        ingredients: [
          { inventoryItemId: 10, name: "Spice A", quantityUsed: "1", unit: "g", stockUnit: "kg" },
          { inventoryItemId: 11, name: "Spice B", quantityUsed: "1", unit: "g", stockUnit: "kg" },
          { inventoryItemId: 12, name: "Spice C", quantityUsed: "1", unit: "g", stockUnit: "kg" },
        ],
        inventory: [
          { id: 10, item: "Spice A", unit: "kg", unitCost: 1.664 },
          { id: 11, item: "Spice B", unit: "kg", unitCost: 1.664 },
          { id: 12, item: "Spice C", unit: "kg", unitCost: 1.664 },
        ],
        targetFoodCost: 0.3,
      });
      assert.equal(tinyLines.cost, 0.01, "Line costs must round with .toFixed(4) before summing to match backend costing.js");
    });

    it("TEST 5.5: prototype-key variation labels ('toString', 'constructor', '__proto__') compute numeric costs via null-prototype map with Object.prototype unpolluted", async () => {
      const menuCosting = await loadMenuCosting();
      assert.ok(menuCosting, "src/utils/menuCosting.js must exist and export shared costing helpers");

      const safeMap = menuCosting.buildSafeSizeQtyMap([
        ["toString", "10"],
        ["constructor", "20"],
        ["__proto__", "30"],
      ]);
      assert.equal(Object.getPrototypeOf(safeMap), null, "buildSafeSizeQtyMap must return a null-prototype object");
      assert.equal(menuCosting.readSizeQtyValue(safeMap, "toString"), "10");
      assert.equal(menuCosting.readSizeQtyValue(safeMap, "constructor"), "20");
      assert.equal(menuCosting.readSizeQtyValue(safeMap, "__proto__"), "30");
      assert.equal(menuCosting.readSizeQtyValue({}, "toString"), undefined, "Must never inherit Object.prototype.toString");
      assert.equal(menuCosting.readSizeQtyValue({}, "constructor"), undefined, "Must never inherit Object.prototype.constructor");
      assert.equal(({}).polluted, undefined);
      assert.equal(typeof ({}).toString, "function");

      const inventory = [{ id: 5, item: "Cocoa", unit: "g", unitCost: 0.5 }];
      const ingredients = [
        {
          inventoryItemId: 5,
          name: "Cocoa",
          quantityUsed: "10",
          quantityBySize: safeMap,
          unit: "g",
          stockUnit: "g",
        },
      ];

      for (const [label, expectedCost] of [
        ["toString", 5],
        ["constructor", 10],
        ["__proto__", 15],
      ]) {
        const res = menuCosting.computeMenuItemCostSummary({
          sellingPrice: 100,
          sizeLabel: label,
          ingredients,
          inventory,
          targetFoodCost: 0.3,
        });
        assert.equal(res.cost, expectedCost, `Variation '${label}' must compute numeric cost ${expectedCost}`);
        assert.equal(res.costComplete, true);
      }

      assert.equal(Object.prototype.toString !== "10", true);
      assert.equal(Object.getPrototypeOf({}), Object.prototype);
    });

    it("TEST 5.6: fractional targetFoodCost 0.335 (33.5%) preserves full precision without integer rounding drift", () => {
      assert.equal(normalizeTargetFoodCost(0.335), 0.335);
      assert.equal(Number((normalizeTargetFoodCost(0.335) * 100).toFixed(2)), 33.5);

      const fractionalDirect = computeMenuItemCostSummary({
        sellingPrice: 80,
        directCostPrice: 17,
        ingredients: [],
        inventory: [],
        targetFoodCost: 0.335,
      });
      assert.equal(fractionalDirect.cost, 17);
      assert.equal(fractionalDirect.costComplete, true);
      assert.equal(fractionalDirect.costSource, "direct");
      assert.equal(
        fractionalDirect.suggestedPrice,
        55,
        "17 / 0.335 must suggest 55 (not 50 caused by Math.round(33.5)->34%)",
      );
    });

    it("TEST 5.7: writeSizeQtyValue performs immutable null-prototype updates for normal and prototype-key variation labels", () => {
      const initial = buildSafeSizeQtyMap([
        ["Regular", "10"],
        ["toString", "5"],
      ]);
      const updated = writeSizeQtyValue(initial, "Regular", "25");
      assert.equal(Object.getPrototypeOf(updated), null);
      assert.equal(readSizeQtyValue(updated, "Regular"), "25");
      assert.equal(readSizeQtyValue(updated, "toString"), "5");
      assert.equal(readSizeQtyValue(initial, "Regular"), "10", "Original map must remain immutable");

      const withProto = writeSizeQtyValue(writeSizeQtyValue(updated, "__proto__", "99"), "constructor", "77");
      assert.equal(readSizeQtyValue(withProto, "__proto__"), "99");
      assert.equal(readSizeQtyValue(withProto, "constructor"), "77");
      assert.equal(Object.getPrototypeOf({}), Object.prototype);
      assert.equal(({}).polluted, undefined);
      assert.equal(typeof ({}).toString, "function");

      const clearedRegular = writeSizeQtyValue(withProto, "Regular", "");
      assert.equal(readSizeQtyValue(clearedRegular, "Regular"), "");
      assert.equal(readSizeQtyValue(withProto, "Regular"), "25");
    });

    it("TEST 5.8: supports 1-size variation costing and preserves untrimmed size keys like 'Large ' until trim on submit", async () => {
      const soloInventory = [{ id: 6, item: "Matcha", unit: "g", unitCost: 0.8 }];
      const soloForm = {
        price: "65",
        sizes: [{ label: "Solo", price: "65", factor: 1.0 }],
        ingredients: [
          {
            inventoryItemId: 6,
            name: "Matcha",
            quantityUsed: "15",
            quantityBySize: buildSafeSizeQtyMap([["Solo", "15"]]),
            unit: "g",
            stockUnit: "g",
          },
        ],
      };

      const soloCosting = computeSafeSizeCosting("Solo", "65", soloForm, soloInventory, 0.4);
      assert.equal(soloCosting.cost, 12);
      assert.equal(soloCosting.costComplete, true);
      assert.equal(soloCosting.suggestedPrice, 30);

      const untrimmedMap = writeSizeQtyValue(null, "Large ", "25");
      assert.equal(readSizeQtyValue(untrimmedMap, "Large "), "25");
      const untrimmedCosting = computeMenuItemCostSummary({
        sellingPrice: 120,
        sizeLabel: "Large ",
        ingredients: [
          {
            inventoryItemId: 6,
            name: "Matcha",
            quantityUsed: "10",
            quantityBySize: untrimmedMap,
            unit: "g",
            stockUnit: "g",
          },
        ],
        inventory: soloInventory,
        targetFoodCost: 0.3,
      });
      assert.equal(
        untrimmedCosting.cost,
        20,
        "Untrimmed in-form size key 'Large ' must resolve directly via readSizeQtyValue",
      );

      const menuPagePath = path.resolve("src/pages/admin/AdminMenuManagement.jsx");
      const menuPageSource = await fs.readFile(menuPagePath, "utf-8");
      assert.equal(
        menuPageSource.includes("formValues.sizes.length > 0"),
        true,
        "AdminMenuManagement.jsx must support 1-size products via sizes.length > 0",
      );
      assert.equal(
        menuPageSource.includes("rawLabel: String(s?.label ?? \"\")"),
        true,
        "AdminMenuManagement.jsx must retain rawLabel alongside trimmed label before submit",
      );
      assert.equal(
        menuPageSource.includes("readSizeQtyValue(ingredient?.quantityBySize, size.rawLabel)"),
        true,
        "AdminMenuManagement.jsx must look up rawLabel quantity before trimming size label",
      );
      assert.equal(
        menuPageSource.includes("/ 0.3 / 5"),
        false,
        "AdminMenuManagement.jsx must not retain hardcoded / 0.3 / 5 pricing formula",
      );
    });
  });
});
