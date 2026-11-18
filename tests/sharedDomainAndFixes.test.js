import "./helpers/loadEnv.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as sharedUnits from "../shared/units.js";
import * as apiUnits from "../api/src/utils/inventoryUnits.js";
import * as sharedCosting from "../shared/costing.js";
import * as apiCosting from "../api/src/utils/costing.js";
import * as sharedWaste from "../shared/wasteMeasurement.js";
import * as apiWaste from "../api/src/utils/wasteMeasurement.js";
import * as srcWaste from "../src/utils/wasteMeasurement.js";
import * as menuCosting from "../src/utils/menuCosting.js";
import * as manilaDate from "../shared/manilaDate.js";
import * as cartStock from "../src/utils/cartStock.js";

describe("Batch 3C: Shared Domain Package & Boundary Fixes", () => {
  it("shared/units.js handles tiny weights (0.0004 g -> kg) and container units consistently across backend & frontend", () => {
    const tiny = sharedUnits.toInventoryQuantity(0.0004, "g", "kg");
    assert.equal(tiny, 4e-7);
    assert.equal(apiUnits.toInventoryQuantity(0.0004, "g", "kg"), 4e-7);
    assert.equal(menuCosting.convertRecipeAmount(0.0004, "g", "kg"), 4e-7);

    // Container units match themselves cleanly without allowing bottle -> pcs
    assert.equal(sharedUnits.toInventoryQuantity(2, "bottles", "bottle"), 2);
    assert.equal(sharedUnits.toInventoryQuantity(3, "packs", "pack"), 3);
    assert.equal(sharedUnits.toInventoryQuantity(1, "bottle", "pcs"), null);
    assert.equal(sharedUnits.toInventoryQuantity(1, "can", "pcs"), 1);

    // Half-up currency rounding without -0 artifacts
    assert.equal(sharedUnits.round2(1.005), 1.01);
    assert.ok(Object.is(sharedUnits.round2(-0), 0));
  });

  it("shared/wasteMeasurement.js is identical across shared/, api/, and src/", () => {
    const item = { id: 1, item: "Espresso Beans", unit: "kg", quantity: 2.5 };
    const args = {
      item,
      measurementMethod: "remaining_count",
      measuredQuantity: 1500,
      measuredUnit: "g",
      tareWeight: 200,
      wasteReason: "spill_accident",
      note: "Spilled espresso beans during test",
    };
    const rShared = sharedWaste.computeWasteDeduction(args);
    const rApi = apiWaste.computeWasteDeduction(args);
    const rSrc = srcWaste.computeWasteDeduction(args);

    assert.equal(rShared.ok, true);
    assert.equal(rShared.deductedQuantity, 1.2);
    assert.equal(rShared.afterQuantity, 1.3);
    assert.deepEqual(rApi, rShared);
    assert.deepEqual(rSrc, rShared);
  });

  it("shared/costing.js computes order totals, discounts, and VAT deterministically", () => {
    assert.equal(apiCosting.summarizeCosting, sharedCosting.summarizeCosting);

    const totals = sharedCosting.computeOrderTotals({
      items: [
        { price: 120, quantity: 2 },
        { price: 55, quantity: 1 },
      ],
      discountPct: 20,
      vatEnabled: true,
      vatRatePercent: 12,
    });
    assert.equal(totals.subtotal, 295);
    assert.equal(totals.discountAmount, 59);
    assert.equal(totals.netTaxable, 236);
    assert.equal(totals.taxAmount, 28.32);
    assert.equal(totals.grandTotal, 264.32);
  });

  it("shared/manilaDate.js formats Asia/Manila dates across UTC midnight and validates calendar dates", () => {
    // 2026-11-18T17:30:00Z is 2026-11-19 01:30 AM in Asia/Manila (+08:00)
    const utcEvening = new Date("2026-11-18T17:30:00.000Z");
    assert.equal(manilaDate.getManilaDateString(utcEvening), "2026-11-19");
    assert.equal(manilaDate.formatDbDateOnly(utcEvening), "2026-11-19");
    assert.equal(manilaDate.formatManilaDate(utcEvening), "Nov 19, 2026");

    assert.equal(manilaDate.isValidIsoDateOnly("2026-11-19"), true);
    assert.equal(manilaDate.isValidIsoDateOnly("2026-02-30"), false);
    assert.equal(manilaDate.isValidIsoDateOnly("not-a-date"), false);
  });

  it("cartStock.js handles 0.3 / 0.1 + 1e-9 epsilon, missing sizeLabel rejection, and tracked add-on stock ceilings", () => {
    // Exact boundary: 0.3 / 0.1 === 2.9999999999999996 in IEEE-754 float math
    const milkTea = {
      id: 99,
      name: "Okinawa Milk Tea",
      sizes: [
        {
          label: "Regular",
          price: 95,
          ingredients: [
            {
              inventoryItemId: 501,
              name: "Tea Base",
              stockUnit: "l",
              inventoryQuantity: 0.3,
              quantityInStockUnit: 0.1,
            },
          ],
        },
      ],
      addons: [],
    };

    const okThree = cartStock.canFulfillCartAddition({
      cartItems: [],
      catalogProducts: [milkTea],
      targetProduct: milkTea,
      sizeLabel: "Regular",
      addQuantity: 3,
    });
    assert.equal(okThree.allowed, true);
    assert.equal(okThree.maxAdditionalQty, 3);
    assert.equal(okThree.shortages.length, 0);

    const failFour = cartStock.canFulfillCartAddition({
      cartItems: [],
      catalogProducts: [milkTea],
      targetProduct: milkTea,
      sizeLabel: "Regular",
      addQuantity: 4,
    });
    assert.equal(failFour.allowed, false);
    assert.equal(failFour.maxAdditionalQty, 3);

    // Invalid sizeLabel should reject instead of silently falling back to Regular
    const badSize = cartStock.canFulfillCartAddition({
      cartItems: [],
      catalogProducts: [milkTea],
      targetProduct: milkTea,
      sizeLabel: "Gigantic",
      addQuantity: 1,
    });
    assert.equal(badSize.allowed, false);
    assert.equal(badSize.maxAdditionalQty, 0);

    // Tracked add-on on a non-recipe item must STILL honor matchedCatalog.stock ceiling
    const pastryWithAddon = {
      id: 100,
      name: "Choco Muffin",
      stock: 2,
      sizes: [{ label: "Regular", price: 65, ingredients: [] }],
      addons: [
        {
          label: "Whipped Cream",
          price: 15,
          inventoryItemId: 601,
          stockUnit: "pcs",
          inventoryQuantity: 50,
          quantityInStockUnit: 1,
        },
      ],
    };

    const allowTwo = cartStock.canFulfillCartAddition({
      cartItems: [],
      catalogProducts: [pastryWithAddon],
      targetProduct: pastryWithAddon,
      sizeLabel: "Regular",
      addons: ["Whipped Cream"],
      addQuantity: 2,
    });
    assert.equal(allowTwo.allowed, true);
    assert.equal(allowTwo.maxAdditionalQty, 2);

    const denyThree = cartStock.canFulfillCartAddition({
      cartItems: [],
      catalogProducts: [pastryWithAddon],
      targetProduct: pastryWithAddon,
      sizeLabel: "Regular",
      addons: ["Whipped Cream"],
      addQuantity: 3,
    });
    assert.equal(denyThree.allowed, false);
    assert.equal(denyThree.maxAdditionalQty, 2);
  });
});
