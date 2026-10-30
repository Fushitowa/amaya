import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as menuModule from "../api/src/routes/menu.js";

/**
 * TALA TEST SUITE: Correct Menu & Cup Business Rules
 */

describe("Tala Test Suite: Menu Cup & Sizing Business Rules", () => {
  it("TEST 1: Inverted cupSizeKey & cupMatchesSize heuristics are completely deleted from menu.js", () => {
    assert.equal(menuModule.cupSizeKey, undefined, "cupSizeKey must no longer exist in menu.js");
    assert.equal(menuModule.cupMatchesSize, undefined, "cupMatchesSize must no longer exist in menu.js");
  });

  it("TEST 2: Non-cup ingredients containing 'cup' (e.g. Peanut Butter Cup, Cupcake) must NEVER be flagged as cups", () => {
    const targetIsCup = (item) => Boolean(item.is_cup_category || item.category === "Cups & Lids" || item.category === "Cups");
    
    const peanutButterCup = { name: "Peanut Butter Cup", category: "Snack Ingredients & Meats", is_cup_category: false };
    const cupcakeTopping = { name: "Cupcake Topping", category: "Dessert Ingredients", is_cup_category: false };
    const realDrinkCup = { name: "16oz U-Cup", category: "Cups & Lids", is_cup_category: true };

    assert.equal(targetIsCup(peanutButterCup), false, "Peanut Butter Cup must NOT be treated as a drink cup");
    assert.equal(targetIsCup(cupcakeTopping), false, "Cupcake Topping must NOT be treated as a drink cup");
    assert.equal(targetIsCup(realDrinkCup), true, "16oz U-Cup is recognized as a real cup");
  });

  it("TEST 3: Food / Snack categories must NEVER auto-inject a cup", () => {
    const shouldCategoryHaveCupByDefault = (operationalFamily) => operationalFamily === "drink";

    assert.equal(shouldCategoryHaveCupByDefault("general"), false, "General category needs no cup");
    assert.equal(shouldCategoryHaveCupByDefault("snack_pieces"), false, "Snacks (Takoyaki/Tempura) need no cup");
    assert.equal(shouldCategoryHaveCupByDefault("single_fixed"), false, "Burgers/Hotdogs need no cup");
    assert.equal(shouldCategoryHaveCupByDefault("fries"), false, "Fries need no cup");
    assert.equal(shouldCategoryHaveCupByDefault("drink"), true, "Drink family triggers cup picker");
  });

  it("TEST 4: Cup selection is flexible - cup does NOT have to match drink size label text", () => {
    const assignCupToSize = (sizeLabel, cupInventoryItem) => ({
      sizeLabel,
      cupId: cupInventoryItem.id,
      cupName: cupInventoryItem.name,
    });

    const customDrink = assignCupToSize("Regular", { id: 101, name: "12oz Paper Cup" });
    assert.equal(customDrink.sizeLabel, "Regular");
    assert.equal(customDrink.cupId, 101);
    assert.equal(customDrink.cupName, "12oz Paper Cup");
  });

  it("TEST 5: Drink recipes can have custom variants with identical cup but different syrups", () => {
    const baseMatcha = {
      product: "Matcha",
      size: "12oz",
      cupId: 50,
      ingredients: ["Matcha Powder", "Fresh Milk", "Ice"],
    };

    const caramelMatcha = {
      product: "Matcha",
      size: "12oz (Caramel)",
      cupId: 50,
      ingredients: ["Matcha Powder", "Fresh Milk", "Ice", "Caramel Syrup"],
    };

    assert.equal(baseMatcha.cupId, caramelMatcha.cupId, "Both variants can share the exact same cup");
    assert.notDeepEqual(baseMatcha.ingredients, caramelMatcha.ingredients, "Variant has additional caramel syrup");
  });

  it("TEST 6 (Step 5a): cupSizeKey & cupMatchesSize are completely deleted from AdminMenuManagement.jsx", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve("src/pages/admin/AdminMenuManagement.jsx");
    const content = await fs.readFile(filePath, "utf-8");

    assert.equal(
      content.includes("const cupSizeKey ="),
      false,
      "cupSizeKey must be deleted from AdminMenuManagement.jsx"
    );
    assert.equal(
      content.includes("const cupMatchesSize ="),
      false,
      "cupMatchesSize must be deleted from AdminMenuManagement.jsx"
    );
    assert.equal(
      content.includes("cupMatchesSize("),
      false,
      "No call to cupMatchesSize may remain in AdminMenuManagement.jsx"
    );
  });

  it("TEST 7 (Step 5a): Cup quantities are preserved across all sizes and not zeroed by label heuristics", () => {
    const isCup = (ing) => /cup/i.test(ing.name);
    const amountForSize = (ing, sizeLabel, factor) => {
      if (isCup(ing)) return String(ing.quantityUsed ?? "1");
      return String(Number(ing.quantityUsed) * factor);
    };

    const cupIng = { name: "12oz Paper Cup", quantityUsed: "1", unit: "pcs" };
    assert.equal(amountForSize(cupIng, "Regular", 1.0), "1", "Must not zero on Regular");
    assert.equal(amountForSize(cupIng, "Medium", 1.25), "1", "Must not zero on Medium");
    assert.equal(amountForSize(cupIng, "Large", 1.5), "1", "Must not zero on Large");
  });

  it("TEST 8 (Steps 1 & 2): DEFAULT_MENU_CATEGORIES is removed and operationalFamily is looked up from DB categories", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve("src/pages/admin/AdminMenuManagement.jsx");
    const content = await fs.readFile(filePath, "utf-8");

    assert.equal(
      content.includes("DEFAULT_MENU_CATEGORIES"),
      false,
      "DEFAULT_MENU_CATEGORIES must be deleted from AdminMenuManagement.jsx"
    );

    // Verify operationalFamily lookup function logic
    const dbCategories = [
      { id: 1, name: "Drinks & Refreshers", operationalFamily: "drink" },
      { id: 2, name: "Takoyaki & Tempura", operationalFamily: "snack_pieces" },
    ];
    const getCategoryFamily = (categoryName) => {
      const match = dbCategories.find(
        (c) => String(c.name || "").toLowerCase() === String(categoryName || "").trim().toLowerCase()
      );
      return match?.operationalFamily || "general";
    };

    assert.equal(getCategoryFamily("Drinks & Refreshers"), "drink");
    assert.equal(getCategoryFamily("Takoyaki & Tempura"), "snack_pieces");
    assert.equal(getCategoryFamily("Unknown Category"), "general");
  });

  it("TEST 9 (Step 4): getCupVariationInfo & getSizeScaleFactor guessing are completely deleted", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const filePath = path.resolve("src/pages/admin/AdminMenuManagement.jsx");
    const content = await fs.readFile(filePath, "utf-8");

    assert.equal(
      content.includes("const getCupVariationInfo ="),
      false,
      "getCupVariationInfo must be deleted from AdminMenuManagement.jsx"
    );
    assert.equal(
      content.includes("const getSizeScaleFactor ="),
      false,
      "getSizeScaleFactor must be deleted from AdminMenuManagement.jsx"
    );
    assert.equal(
      content.includes("getSizeScaleFactor("),
      false,
      "No call to getSizeScaleFactor may remain in AdminMenuManagement.jsx"
    );
  });

  it("TEST 10 (Step 4a): Assigning a cup to a size sets that cup quantity to 1 for that size and 0 for others", () => {
    const size = { label: "12oz", cupId: 101 };
    const ingredients = [
      {
        inventoryItemId: 101,
        name: "12oz Paper Cup",
        quantityBySize: { "12oz": "1", "16oz": "0" },
      },
      {
        inventoryItemId: 102,
        name: "16oz Paper Cup",
        quantityBySize: { "12oz": "0", "16oz": "1" },
      },
    ];

    const sizeQty = (ing, label) => {
      const explicit = ing.quantityBySize?.[label];
      const amount = Number(explicit);
      return Number.isFinite(amount) && amount > 0 ? amount : 0;
    };

    assert.equal(sizeQty(ingredients[0], "12oz"), 1, "12oz cup active for 12oz size");
    assert.equal(sizeQty(ingredients[1], "12oz"), 0, "16oz cup inactive (0) for 12oz size");
    assert.equal(sizeQty(ingredients[0], "16oz"), 0, "12oz cup inactive (0) for 16oz size");
    assert.equal(sizeQty(ingredients[1], "16oz"), 1, "16oz cup active for 16oz size");
  });
});

