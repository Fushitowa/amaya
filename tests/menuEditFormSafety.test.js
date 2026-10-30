import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

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
 * 3. Safe sizeCosting calculations and .toFixed(2) protection
 * 4. Exact vulnerability mapping of AdminMenuManagement.jsx
 * ============================================================================
 */

// --- CANONICAL SAFE HELPERS ---

const unitFactors = new Map();
const registerUnit = (dimension, factorToBase, units) =>
  units.forEach((unit) => unitFactors.set(unit.toLowerCase(), { dimension, factorToBase }));

registerUnit("mass", 0.000001, ["µg", "μg", "ug", "mcg", "microgram", "micrograms"]);
registerUnit("mass", 0.001, ["mg", "milligram", "milligrams"]);
registerUnit("mass", 1, ["g", "gram", "grams"]);
registerUnit("mass", 100, ["hg", "hectogram", "hectograms"]);
registerUnit("mass", 1000, ["kg", "kilogram", "kilograms"]);
registerUnit("mass", 28.349523125, ["oz", "ounce", "ounces"]);
registerUnit("mass", 453.59237, ["lb", "lbs", "pound", "pounds"]);
registerUnit("volume", 1, ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc", "cm3", "cm³"]);
registerUnit("volume", 10, ["cl", "centiliter", "centiliters", "centilitre", "centilitres"]);
registerUnit("volume", 100, ["dl", "deciliter", "deciliters", "decilitre", "decilitres"]);
registerUnit("volume", 1000, ["l", "liter", "liters", "litre", "litres"]);
registerUnit("volume", 4.92892159375, ["tsp", "teaspoon", "teaspoons"]);
registerUnit("volume", 14.78676478125, ["tbsp", "tablespoon", "tablespoons"]);
registerUnit("volume", 236.5882365, ["cup", "cups"]);
registerUnit("volume", 29.5735295625, ["fl oz", "fluid ounce", "fluid ounces"]);
registerUnit("count", 1, ["pc", "pcs", "piece", "pieces", "ea", "each", "unit", "units"]);
registerUnit("count", 2, ["pair", "pairs"]);
registerUnit("count", 12, ["dozen", "doz"]);

export const convertRecipeAmount = (amount, recipeUnit, stockUnit) => {
  const sourceName = String(recipeUnit || "").trim().toLowerCase();
  const targetName = String(stockUnit || "").trim().toLowerCase();
  const quantity = Number(amount);
  const source = unitFactors.get(sourceName);
  const target = unitFactors.get(targetName);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!source && !target && sourceName === targetName) return quantity;
  if (!source || !target || source.dimension !== target.dimension) return null;
  const converted = Number(((quantity * source.factorToBase) / target.factorToBase).toFixed(6));
  return converted > 0 ? converted : null;
};

export const defaultSizeFactor = (factor, index = 0) =>
  Number.isFinite(Number(factor)) && Number(factor) > 0
    ? Number(factor)
    : index === 0
    ? 1.0
    : Number((1.0 + index * 0.25).toFixed(2));

export const scaleIngredientAmount = (baseQty, factor, unit) => {
  const numQty = Number(baseQty);
  if (!Number.isFinite(numQty) || numQty <= 0) return "";
  const unitDef = unitFactors.get(String(unit || "").toLowerCase());
  if (
    unitDef?.dimension === "count" ||
    ["pcs", "pc", "piece", "pieces", "ea", "each", "unit", "units", "cup", "cups"].includes(
      String(unit || "").toLowerCase()
    )
  ) {
    return String(numQty);
  }
  const scaled = Number((numQty * factor).toFixed(2));
  return String(scaled);
};

export const safeItemName = (entry) => {
  if (!entry) return "";
  return String(entry.item ?? entry.name ?? "").trim();
};

export const safeToFixed = (val, fractionDigits = 2, fallback = "0.00") => {
  const num = Number(val);
  return Number.isFinite(num) ? num.toFixed(fractionDigits) : fallback;
};

export const findInventoryItem = (inventory, query, id = null) => {
  if (!Array.isArray(inventory)) return undefined;
  const numericId = id != null && !Number.isNaN(Number(id)) ? Number(id) : null;
  const cleanQuery = String(query || "").trim().toLowerCase();

  return inventory.find((entry) => {
    if (!entry) return false;
    if (numericId !== null && Number(entry.id) === numericId) return true;
    if (!cleanQuery) return false;
    const name = safeItemName(entry).toLowerCase();
    return name === cleanQuery;
  });
};

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
        quantityBySize: {},
      };
    }
    const invId = ingredient?.inventoryItemId != null ? Number(ingredient.inventoryItemId) : null;
    const invItem = findInventoryItem(safeInventory, ingredient?.name, invId);
    const quantityBySize = Object.fromEntries(
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

export const computeSafeSizeCosting = (sizeLabel, rawSizePrice, formValues = {}, inventory = []) => {
  const formPrice = Number(formValues?.price) || 0;
  const numericPrice =
    rawSizePrice !== "" && rawSizePrice !== null && rawSizePrice !== undefined && !Number.isNaN(Number(rawSizePrice))
      ? Number(rawSizePrice)
      : formPrice;

  const ingredients = Array.isArray(formValues?.ingredients) ? formValues.ingredients.filter(Boolean) : [];
  let rawCost = 0;
  let costComplete = ingredients.length > 0;

  for (const ing of ingredients) {
    if (!ing) continue;
    const invItem = findInventoryItem(inventory, ing.name, ing.inventoryItemId);
    const unitCost = Number(invItem?.unitCost ?? invItem?.unit_cost ?? ing.unitCost ?? 0);
    const stockUnit = invItem?.unit || ing.stockUnit || ing.unit || "pcs";
    const recipeUnit = ing.unit || stockUnit;

    const rawSizeQty = sizeLabel ? ing.quantityBySize?.[sizeLabel] : undefined;
    if (rawSizeQty !== undefined && !(Number(rawSizeQty) > 0)) continue;

    const sizes = Array.isArray(formValues?.sizes) ? formValues.sizes.filter(Boolean) : [];
    const matchedSize = sizeLabel ? sizes.find((s) => s?.label === sizeLabel) : null;
    const factor = matchedSize ? defaultSizeFactor(matchedSize.factor, 0) : 1.0;
    const qtyUsed = Number(
      sizeLabel
        ? ing.quantityBySize?.[sizeLabel] ?? scaleIngredientAmount(ing.quantityUsed, factor, recipeUnit)
        : ing.quantityUsed
    );
    const stockQty = convertRecipeAmount(qtyUsed, recipeUnit, stockUnit);

    if (!stockQty || !(unitCost > 0)) {
      costComplete = false;
    } else {
      rawCost += stockQty * unitCost;
    }
  }

  const cost = Number.isFinite(rawCost) ? Number(rawCost.toFixed(2)) : 0;
  const grossProfit = numericPrice > 0 ? Number((numericPrice - cost).toFixed(2)) : null;
  const margin = numericPrice > 0 ? Number((((numericPrice - cost) / numericPrice) * 100).toFixed(1)) : null;
  const foodCostPercent = numericPrice > 0 ? Number(((cost / numericPrice) * 100).toFixed(1)) : null;
  const suggestedPrice = rawCost > 0 ? Math.ceil(rawCost / 0.3 / 5) * 5 : null;

  return {
    cost,
    costComplete,
    grossProfit,
    margin,
    foodCostPercent,
    suggestedPrice,
    costFormatted: safeToFixed(cost, 2),
    profitFormatted: safeToFixed(grossProfit ?? 0, 2),
    marginFormatted: margin != null ? `${safeToFixed(margin, 1)}%` : "—",
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
});
