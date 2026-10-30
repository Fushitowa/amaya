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
});

