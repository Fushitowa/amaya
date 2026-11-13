import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import pool from "../api/src/database.js";
import * as costing from "../api/src/utils/costing.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

function assertHeaderTokens(headerValue, expectedTokens, headerName) {
  const tokens = String(headerValue || "")
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const expected of expectedTokens) {
    assert.equal(
      tokens.includes(expected.toLowerCase()),
      true,
      `Expected ${headerName} header "${headerValue || ""}" to include "${expected}"`,
    );
  }
}

function buildValidSettingsBody(overrides = {}) {
  return {
    businessName: "Amaya's Drinks and Bites",
    email: "jessiecataya25@gmail.com",
    phone: "09636017184",
    address: "Barangay Lilingayon, Valencia City, Bukidnon",
    openingTime: "09:00",
    closingTime: "19:00",
    targetFoodCost: 0.3,
    ...overrides,
  };
}

describe("Tala Suite: Business Settings Security, Target Food Cost Bounds & Downstream Costing Propagation", () => {
  let server;
  let adminUser;
  let staffUser;
  const tracker = createCleanupTracker();

  before(async () => {
    await tracker.trackBusinessSettings();
    server = await startTestServer();
    adminUser = await tracker.createUser({ role: "admin" });
    staffUser = await tracker.createUser({ role: "staff" });
  });

  after(async () => {
    try {
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  describe("SUITE 1: Backend Costing Contract & IEEE-754 Parity (api/src/utils/costing.js)", () => {
    it("TEST 1.1: exports normalizeTargetFoodCost + MIN/MAX/DEFAULT bounds and rejects out-of-range or non-scalar coercions", () => {
      assert.equal(costing.DEFAULT_TARGET_FOOD_COST, 0.3);
      assert.equal(costing.MIN_TARGET_FOOD_COST, 0.1);
      assert.equal(costing.MAX_TARGET_FOOD_COST, 0.9);
      assert.equal(
        typeof costing.normalizeTargetFoodCost,
        "function",
        "costing.js must export normalizeTargetFoodCost(value, fallback)",
      );

      assert.equal(costing.normalizeTargetFoodCost(0.1), 0.1);
      assert.equal(costing.normalizeTargetFoodCost(0.9), 0.9);
      assert.equal(costing.normalizeTargetFoodCost("0.42"), 0.42);
      assert.equal(costing.normalizeTargetFoodCost(0.34567), 0.3457);

      const badTargets = [0.09, 0.91, 0, 1, -0.3, NaN, Infinity, -Infinity, null, undefined, "", true, false, [], [0.5], {}];
      for (const bad of badTargets) {
        assert.equal(
          costing.normalizeTargetFoodCost(bad),
          0.3,
          `Invalid target ${JSON.stringify(bad)} must fall back to 0.3`,
        );
        assert.equal(
          costing.normalizeTargetFoodCost(bad, 0.4),
          0.4,
          `Invalid target ${JSON.stringify(bad)} must respect custom fallback 0.4`,
        );
      }
    });

    it("TEST 1.2: summarizeCosting fixes IEEE-754 ceil boundary (5.25 / 0.35 -> 15) and enforces [0.10, 0.90] bounds", () => {
      const exactBoundary = costing.summarizeCosting(0, [{ cost: 5.25, complete: true }], 0.35);
      assert.equal(exactBoundary.cost, 5.25);
      assert.equal(exactBoundary.costComplete, true);
      assert.equal(exactBoundary.grossProfit, null);
      assert.equal(
        exactBoundary.suggestedPrice,
        15,
        "5.25 at 0.35 target must suggest 15 (not IEEE-754 overshot 20)",
      );

      const clampedBelowMin = costing.summarizeCosting(100, [{ cost: 9, complete: true }], 0.05);
      assert.equal(
        clampedBelowMin.suggestedPrice,
        30,
        "Target 0.05 (< 0.10) must fall back to 0.30 so cost 9 suggests 30 (not 180)",
      );
    });

    it("TEST 1.3: summarizeCosting handles empty parts / zero cost (costComplete: false) and null grossProfit at sellingPrice 0", () => {
      const noParts = costing.summarizeCosting(0, []);
      assert.equal(noParts.cost, 0);
      assert.equal(noParts.costComplete, false);
      assert.equal(noParts.grossProfit, null);
      assert.equal(noParts.margin, null);
      assert.equal(noParts.foodCostPercent, null);
      assert.equal(noParts.suggestedPrice, null);

      const zeroCostIncomplete = costing.summarizeCosting(0, [{ cost: 0, complete: false }]);
      assert.equal(zeroCostIncomplete.cost, 0);
      assert.equal(zeroCostIncomplete.costComplete, false);
      assert.equal(zeroCostIncomplete.grossProfit, null);
      assert.equal(zeroCostIncomplete.suggestedPrice, null);

      const pricedWithZeroSelling = costing.summarizeCosting(0, [{ cost: 15, complete: true }], 0.3);
      assert.equal(pricedWithZeroSelling.grossProfit, null);
      assert.equal(pricedWithZeroSelling.suggestedPrice, 50);
    });
  });

  describe("SUITE 2: GET /api/settings Role-Scoping & Header Hygiene (SEC-01, F-02)", () => {
    it("TEST 2.1: unauthenticated GET /api/settings returns 200 public fields WITHOUT targetFoodCost and emits cache/vary headers", async () => {
      const res = await server.requestJson("/api/settings");
      assert.equal(res.status, 200);
      assert.equal(typeof res.data.businessName, "string");
      assert.equal(
        Object.hasOwn(res.data, "targetFoodCost"),
        false,
        "Unauthenticated GET /api/settings must NOT expose targetFoodCost",
      );
      assertHeaderTokens(res.headers.get("cache-control"), ["private", "no-store"], "Cache-Control");
      assertHeaderTokens(res.headers.get("vary"), ["Authorization"], "Vary");
    });

    it("TEST 2.2: staff GET /api/settings returns 200 public fields WITHOUT targetFoodCost and emits cache/vary headers", async () => {
      const res = await server.requestJson("/api/settings", { token: staffUser.token });
      assert.equal(res.status, 200);
      assert.equal(typeof res.data.businessName, "string");
      assert.equal(
        Object.hasOwn(res.data, "targetFoodCost"),
        false,
        "Staff GET /api/settings must NOT expose targetFoodCost",
      );
      assertHeaderTokens(res.headers.get("cache-control"), ["private", "no-store"], "Cache-Control");
      assertHeaderTokens(res.headers.get("vary"), ["Authorization"], "Vary");
    });

    it("TEST 2.3: admin GET /api/settings returns 200 WITH numeric targetFoodCost in [0.10, 0.90] and emits cache/vary headers", async () => {
      const res = await server.requestJson("/api/settings", { token: adminUser.token });
      assert.equal(res.status, 200);
      assert.equal(Object.hasOwn(res.data, "targetFoodCost"), true);
      assert.equal(typeof res.data.targetFoodCost, "number");
      assert.ok(res.data.targetFoodCost >= 0.1 && res.data.targetFoodCost <= 0.9);
      assertHeaderTokens(res.headers.get("cache-control"), ["private", "no-store"], "Cache-Control");
      assertHeaderTokens(res.headers.get("vary"), ["Authorization"], "Vary");
    });

    it("TEST 2.4: /api/menu, /api/menu/categories, and /api/reports/financial-summary enforce header hygiene & RBAC (F-02)", async () => {
      for (const pathName of ["/api/menu", "/api/menu/categories"]) {
        const guestRes = await server.requestJson(pathName);
        assert.equal(guestRes.status, 200);
        assertHeaderTokens(guestRes.headers.get("vary"), ["Authorization"], `${pathName} guest Vary`);

        for (const [roleName, token] of [["staff", staffUser.token], ["admin", adminUser.token]]) {
          const authRes = await server.requestJson(pathName, { token });
          assert.equal(authRes.status, 200);
          assertHeaderTokens(authRes.headers.get("vary"), ["Authorization"], `${pathName} ${roleName} Vary`);
          assertHeaderTokens(
            authRes.headers.get("cache-control"),
            ["private", "no-store"],
            `${pathName} ${roleName} Cache-Control`,
          );
        }
      }

      const reportGuest = await server.requestJson("/api/reports/financial-summary?rangeKey=today");
      assert.equal(reportGuest.status, 401);

      const reportStaff = await server.requestJson("/api/reports/financial-summary?rangeKey=today", {
        token: staffUser.token,
      });
      assert.equal(reportStaff.status, 403);

      const reportAdmin = await server.requestJson("/api/reports/financial-summary?rangeKey=today", {
        token: adminUser.token,
      });
      assert.equal(reportAdmin.status, 200);
      assertHeaderTokens(reportAdmin.headers.get("cache-control"), ["private", "no-store"], "financial-summary Cache-Control");
      assertHeaderTokens(reportAdmin.headers.get("vary"), ["Authorization"], "financial-summary Vary");
    });
  });

  describe("SUITE 3: PUT /api/settings Validation & Trust Boundary (SEC-02)", () => {
    it("TEST 3.1: rejects unauthenticated (401) and staff (403) callers", async () => {
      try {
        const unauthRes = await server.requestJson("/api/settings", {
          method: "PUT",
          body: buildValidSettingsBody({ targetFoodCost: 0.45 }),
        });
        assert.equal(unauthRes.status, 401);

        const staffRes = await server.requestJson("/api/settings", {
          method: "PUT",
          token: staffUser.token,
          body: buildValidSettingsBody({ targetFoodCost: 0.45 }),
        });
        assert.equal(staffRes.status, 403);
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });

    it("TEST 3.2: rejects out-of-range, empty, null, and non-scalar targetFoodCost with HTTP 400", async () => {
      try {
        const invalidTargets = [0.09, 0.91, true, [], [0.4], {}, null, "", "   ", "NaN", "abc"];
        for (const badTarget of invalidTargets) {
          const res = await server.requestJson("/api/settings", {
            method: "PUT",
            token: adminUser.token,
            body: buildValidSettingsBody({ targetFoodCost: badTarget }),
          });
          assert.equal(
            res.status,
            400,
            `Expected HTTP 400 for targetFoodCost=${JSON.stringify(badTarget)}, got ${res.status}`,
          );
        }
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });

    it("TEST 3.3: rejects object/array/boolean coercion on businessName, email, phone, and address with HTTP 400", async () => {
      try {
        const coercionCases = [
          { field: "businessName", values: [{}, [], true, 123] },
          { field: "email", values: [{}, [], true] },
          { field: "phone", values: [{}, [], true] },
          { field: "address", values: [{}, [], true] },
        ];

        for (const { field, values } of coercionCases) {
          for (const badVal of values) {
            const res = await server.requestJson("/api/settings", {
              method: "PUT",
              token: adminUser.token,
              body: buildValidSettingsBody({ [field]: badVal }),
            });
            assert.equal(
              res.status,
              400,
              `Expected HTTP 400 for ${field}=${JSON.stringify(badVal)}, got ${res.status}`,
            );
          }
        }
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });

    it("TEST 3.4: accepts valid admin PUT /api/settings (0.42) and preserves stored targetFoodCost when key is omitted", async () => {
      try {
        const putRes = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({ targetFoodCost: 0.42 }),
        });
        assert.equal(putRes.status, 200);
        assert.equal(putRes.data.targetFoodCost, 0.42);

        const bodyWithoutTarget = buildValidSettingsBody({ businessName: "Amaya's Updated Profile" });
        delete bodyWithoutTarget.targetFoodCost;
        const putOmitted = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: bodyWithoutTarget,
        });
        assert.equal(putOmitted.status, 200);
        assert.equal(putOmitted.data.targetFoodCost, 0.42);

        const adminGet = await server.requestJson("/api/settings", { token: adminUser.token });
        assert.equal(adminGet.status, 200);
        assert.equal(adminGet.data.businessName, "Amaya's Updated Profile");
        assert.equal(adminGet.data.targetFoodCost, 0.42);
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });

    it("TEST 3.5: rejects adversarial 100KB email payload in < 200ms without ReDoS stall (F-01)", async () => {
      try {
        const redosEmail = `a@${".".repeat(100000)} x`;
        const startedAt = performance.now();
        const res = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({ email: redosEmail }),
        });
        const elapsedMs = performance.now() - startedAt;
        assert.equal(res.status, 400);
        assert.ok(elapsedMs < 200, `Expected linear rejection < 200ms, took ${elapsedMs.toFixed(2)}ms`);
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });

    it("TEST 3.6: rejects malformed openingTime/closingTime and malformed email formats with HTTP 400", async () => {
      try {
        for (const badTime of ["09:00xyz", "09:00:99", "25:00", "abc"]) {
          const openRes = await server.requestJson("/api/settings", {
            method: "PUT",
            token: adminUser.token,
            body: buildValidSettingsBody({ openingTime: badTime }),
          });
          assert.equal(openRes.status, 400, `Expected HTTP 400 for openingTime=${badTime}, got ${openRes.status}`);

          const closeRes = await server.requestJson("/api/settings", {
            method: "PUT",
            token: adminUser.token,
            body: buildValidSettingsBody({ closingTime: badTime }),
          });
          assert.equal(closeRes.status, 400, `Expected HTTP 400 for closingTime=${badTime}, got ${closeRes.status}`);
        }

        const badEmails = ["not-an-email", "a@b.", "a@.b", "a@b..c", `${"x".repeat(250)}@b.com`];
        for (const badEmail of badEmails) {
          const emailRes = await server.requestJson("/api/settings", {
            method: "PUT",
            token: adminUser.token,
            body: buildValidSettingsBody({ email: badEmail }),
          });
          assert.equal(emailRes.status, 400, `Expected HTTP 400 for malformed email="${badEmail.slice(0, 32)}", got ${emailRes.status}`);
        }
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });

    it("TEST 3.7: rejects non-object root payloads ([], null, 'string', 123) on PUT /api/settings with HTTP 400", async () => {
      try {
        for (const badRoot of [[], null, "string", 123]) {
          const res = await server.requestRaw("/api/settings", {
            method: "PUT",
            token: adminUser.token,
            body: badRoot,
          });
          assert.equal(
            res.status,
            400,
            `Expected HTTP 400 for non-object body ${JSON.stringify(badRoot)}, got ${res.status}`,
          );
        }
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });
  });

  describe("SUITE 4: Downstream Propagation Proof (/api/menu & /api/reports/financial-summary)", () => {
    it("TEST 4.1: updating targetFoodCost propagates to admin GET /api/menu suggestedPrice & /api/reports/financial-summary while keeping public /api/menu cost-blind", async () => {
      const tag = makeUniqueTag("SettingsFlow");
      const categoryName = `Cat_${tag}`;
      const flourName = `Flour_${tag}`;
      const butterName = `Butter_${tag}`;

      try {
        const [catRes] = await pool.execute(
          "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
          [categoryName],
        );
        tracker.menuCategoryIds.add(Number(catRes.insertId));

        const [flourRes] = await pool.execute(
          "INSERT INTO inventory_items (name, category, quantity, unit, unit_cost) VALUES (?, 'Ingredients', 100, 'pcs', 12.0000)",
          [flourName],
        );
        const flourId = Number(flourRes.insertId);
        tracker.inventoryItemIds.add(flourId);

        const [butterRes] = await pool.execute(
          "INSERT INTO inventory_items (name, category, quantity, unit, unit_cost) VALUES (?, 'Ingredients', 100, 'pcs', 5.2500)",
          [butterName],
        );
        const butterId = Number(butterRes.insertId);
        tracker.inventoryItemIds.add(butterId);

        const recipeCreateRes = await server.requestJson("/api/menu", {
          method: "POST",
          token: adminUser.token,
          body: {
            name: `RecipeMuffin_${tag}`,
            category: categoryName,
            basePrice: 50,
            stock: 20,
            available: true,
            ingredients: [{ inventoryItemId: flourId, name: flourName, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
          },
        });
        assert.equal(recipeCreateRes.status, 201);
        const recipeProdId = Number(recipeCreateRes.data.id);
        tracker.productIds.add(recipeProdId);

        const directCreateRes = await server.requestJson("/api/menu", {
          method: "POST",
          token: adminUser.token,
          body: {
            name: `DirectBiscuit_${tag}`,
            category: categoryName,
            basePrice: 60,
            costPrice: 24,
            stock: 20,
            available: true,
            ingredients: [],
          },
        });
        assert.equal(directCreateRes.status, 201);
        const directProdId = Number(directCreateRes.data.id);
        tracker.productIds.add(directProdId);

        const ieeeCreateRes = await server.requestJson("/api/menu", {
          method: "POST",
          token: adminUser.token,
          body: {
            name: `BoundaryTart_${tag}`,
            category: categoryName,
            basePrice: 25,
            stock: 20,
            available: true,
            ingredients: [{ inventoryItemId: butterId, name: butterName, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
          },
        });
        assert.equal(ieeeCreateRes.status, 201);
        const ieeeProdId = Number(ieeeCreateRes.data.id);
        tracker.productIds.add(ieeeProdId);

        const fractionalCreateRes = await server.requestJson("/api/menu", {
          method: "POST",
          token: adminUser.token,
          body: {
            name: `FractionalBite_${tag}`,
            category: categoryName,
            basePrice: 80,
            costPrice: 17,
            stock: 20,
            available: true,
            ingredients: [],
          },
        });
        assert.equal(fractionalCreateRes.status, 201);
        const fractionalProdId = Number(fractionalCreateRes.data.id);
        tracker.productIds.add(fractionalProdId);

        // Baseline at 0.30
        const set30 = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({ targetFoodCost: 0.3 }),
        });
        assert.equal(set30.status, 200);

        const menu30 = await server.requestJson("/api/menu?all=true", { token: adminUser.token });
        assert.equal(menu30.status, 200);
        const recipeItem30 = menu30.data.find((p) => p.id === recipeProdId);
        const directItem30 = menu30.data.find((p) => p.id === directProdId);
        assert.equal(recipeItem30.suggestedPrice, 40, "Cost 12 at 0.30 target must suggest 40");
        assert.equal(directItem30.suggestedPrice, 80, "Direct costPrice 24 at 0.30 target must suggest 80");

        // Propagate to 0.40
        const set40 = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({ targetFoodCost: 0.4 }),
        });
        assert.equal(set40.status, 200);

        const adminMenu40 = await server.requestJson("/api/menu?all=true", { token: adminUser.token });
        assert.equal(adminMenu40.status, 200);
        const recipeItem40 = adminMenu40.data.find((p) => p.id === recipeProdId);
        const directItem40 = adminMenu40.data.find((p) => p.id === directProdId);
        assert.equal(recipeItem40.suggestedPrice, 30, "Cost 12 at 0.40 target must recalculate to 30");
        assert.equal(directItem40.suggestedPrice, 60, "Direct costPrice 24 at 0.40 target must recalculate to 60");

        // Public /api/menu must NEVER leak recipes or costing targets
        const publicMenu = await server.requestJson("/api/menu");
        assert.equal(publicMenu.status, 200);
        const publicRecipeItem = publicMenu.data.find((p) => p.id === recipeProdId);
        assert.ok(publicRecipeItem, "Available product must appear on public menu");
        assert.deepEqual(publicRecipeItem.ingredients, []);
        assert.equal(Object.hasOwn(publicRecipeItem, "suggestedPrice"), false);
        assert.equal(Object.hasOwn(publicRecipeItem, "cost"), false);
        assert.equal(Object.hasOwn(publicRecipeItem, "costPrice"), false);

        // Financial summary targetFoodCost propagation
        const report40 = await server.requestJson("/api/reports/financial-summary?rangeKey=today", {
          token: adminUser.token,
        });
        assert.equal(report40.status, 200);
        assert.equal(report40.data.summary.targetFoodCost, 0.4);

        // Propagate to 0.35 and prove IEEE-754 boundary (5.25 / 0.35 = 15, NOT 20)
        const set35 = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({ targetFoodCost: 0.35 }),
        });
        assert.equal(set35.status, 200);

        const adminMenu35 = await server.requestJson("/api/menu?all=true", { token: adminUser.token });
        assert.equal(adminMenu35.status, 200);
        const ieeeItem35 = adminMenu35.data.find((p) => p.id === ieeeProdId);
        assert.equal(
          ieeeItem35.suggestedPrice,
          15,
          "Cost 5.25 at 0.35 target in /api/menu must suggest 15 (not IEEE-754 overshot 20)",
        );

        // Propagate fractional 0.335 (33.5%) end-to-end without integer rounding drift (17 / 0.335 -> 55, not 50)
        const set335 = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({ targetFoodCost: 0.335 }),
        });
        assert.equal(set335.status, 200);
        assert.equal(set335.data.targetFoodCost, 0.335);

        const adminMenu335 = await server.requestJson("/api/menu?all=true", { token: adminUser.token });
        assert.equal(adminMenu335.status, 200);
        const fractionalItem335 = adminMenu335.data.find((p) => p.id === fractionalProdId);
        assert.equal(
          fractionalItem335.suggestedPrice,
          55,
          "Cost 17 at fractional 0.335 (33.5%) target must suggest 55 (not Math.round(33.5)->34% / 50)",
        );

        const report335 = await server.requestJson("/api/reports/financial-summary?rangeKey=today", {
          token: adminUser.token,
        });
        assert.equal(report335.status, 200);
        assert.equal(report335.data.summary.targetFoodCost, 0.335);
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });
  });

  describe("SUITE 5: Migration 029 MariaDB CHECK Constraint Proof", () => {
    it("TEST 5.1: chk_business_settings_target_food_cost exists in information_schema and rejects out-of-range DB writes (errno 4025)", async () => {
      const [constraints] = await pool.execute(
        `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
           FROM information_schema.table_constraints
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'business_settings'
            AND CONSTRAINT_NAME = 'chk_business_settings_target_food_cost'
            AND CONSTRAINT_TYPE = 'CHECK'`,
      );
      assert.ok(constraints.length >= 1, "Migration 029 CHECK constraint chk_business_settings_target_food_cost must exist");

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await assert.rejects(
          () => conn.execute("UPDATE business_settings SET target_food_cost = ? WHERE id = 1", [0.05]),
          (err) => err?.errno === 4025,
          "MariaDB CHECK constraint must reject 0.05 with errno 4025",
        );
        await assert.rejects(
          () => conn.execute("UPDATE business_settings SET target_food_cost = ? WHERE id = 1", [0.95]),
          (err) => err?.errno === 4025,
          "MariaDB CHECK constraint must reject 0.95 with errno 4025",
        );
        await conn.execute("UPDATE business_settings SET target_food_cost = ? WHERE id = 1", [0.1]);
        await conn.execute("UPDATE business_settings SET target_food_cost = ? WHERE id = 1", [0.9]);
      } finally {
        await conn.rollback();
        conn.release();
      }
    });
  });

  describe("SUITE 6: Wave 3 Expanded Settings, Trust Tiers, Shift Gate, Discount & VAT Enforcement", () => {
    it("TEST 6.1: 3-tier GET /api/settings trust scoping and partial PUT preservation work cleanly", async () => {
      await tracker.trackBusinessSettings();
      try {
        const putRes = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({
            vatEnabled: true,
            vatRatePercent: 12,
            enforceShiftGate: true,
            discountPresets: [{ label: "VIP (15%)", pct: 15 }],
            lowStockThresholdPercent: 45,
            criticalStockThresholdPercent: 15,
            inactivityAlertDays: 21,
            archiveRetentionDays: 45,
            maxInventoryAdjustmentPct: 150,
            idleLockMinutes: 30,
            exportRowLimit: 2500,
            receiptFooter: "Wave 3 Footer",
          }),
        });
        assert.equal(putRes.status, 200);
        assert.equal(putRes.data.vatEnabled, true);
        assert.equal(putRes.data.vatRatePercent, 12);
        assert.equal(putRes.data.enforceShiftGate, true);
        assert.equal(putRes.data.archiveRetentionDays, 45);
        assert.equal(putRes.data.exportRowLimit, 2500);

        // Partial PUT omitting Wave 3 keys must preserve stored Wave 3 values
        const partialRes = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({ phone: "+63 999 111 2222" }),
        });
        assert.equal(partialRes.status, 200);
        assert.equal(partialRes.data.phone, "+63 999 111 2222");
        assert.equal(partialRes.data.vatEnabled, true);
        assert.equal(partialRes.data.enforceShiftGate, true);
        assert.equal(partialRes.data.archiveRetentionDays, 45);
        assert.equal(partialRes.data.exportRowLimit, 2500);

        // Tier 1: Unauthenticated -> public fields only
        const unauthRes = await server.requestJson("/api/settings");
        assert.equal(unauthRes.status, 200);
        assert.equal(unauthRes.data.receiptFooter, "Wave 3 Footer");
        assert.equal(Object.hasOwn(unauthRes.data, "targetFoodCost"), false);
        assert.equal(Object.hasOwn(unauthRes.data, "vatEnabled"), false);
        assert.equal(Object.hasOwn(unauthRes.data, "enforceShiftGate"), false);
        assert.equal(Object.hasOwn(unauthRes.data, "archiveRetentionDays"), false);

        // Tier 2: Staff -> POS operational fields included, admin financial/threshold fields omitted
        const staffRes = await server.requestJson("/api/settings", { token: staffUser.token });
        assert.equal(staffRes.status, 200);
        assert.equal(staffRes.data.vatEnabled, true);
        assert.equal(staffRes.data.enforceShiftGate, true);
        assert.equal(staffRes.data.discountPresets[0].label, "VIP (15%)");
        assert.equal(Object.hasOwn(staffRes.data, "targetFoodCost"), false);
        assert.equal(Object.hasOwn(staffRes.data, "archiveRetentionDays"), false);
        assert.equal(Object.hasOwn(staffRes.data, "exportRowLimit"), false);
        assert.equal(Object.hasOwn(staffRes.data, "maxInventoryAdjustmentPct"), false);

        // Tier 3: Admin -> full payload
        const adminRes = await server.requestJson("/api/settings", { token: adminUser.token });
        assert.equal(adminRes.status, 200);
        assert.equal(adminRes.data.archiveRetentionDays, 45);
        assert.equal(adminRes.data.exportRowLimit, 2500);
        assert.equal(adminRes.data.maxInventoryAdjustmentPct, 150);
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });

    it("TEST 6.2: rejects invalid Wave 3 bounds (critical >= low, bad discountPresets, bad VAT/exportRowLimit)", async () => {
      await tracker.trackBusinessSettings();
      try {
        const badThreshold = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: { lowStockThresholdPercent: 40, criticalStockThresholdPercent: 45 },
        });
        assert.equal(badThreshold.status, 400);

        const badVat = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: { vatRatePercent: 35 },
        });
        assert.equal(badVat.status, 400);

        const badPreset = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: { discountPresets: [{ label: "", pct: 20 }] },
        });
        assert.equal(badPreset.status, 400);

        const badLimit = await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: { exportRowLimit: 999999 },
        });
        assert.equal(badLimit.status, 400);
      } finally {
        await tracker.restoreBusinessSettings();
      }
    });

    it("TEST 6.3: enforceShiftGate blocks order without open shift (409) and applies preset discount + VAT + ledger posting/void reversal", async () => {
      await tracker.trackBusinessSettings();
      const tag = makeUniqueTag("Wave3Pos");
      const categoryName = `Cat_${tag}`;
      let orderId = null;

      try {
        await server.requestJson("/api/settings", {
          method: "PUT",
          token: adminUser.token,
          body: buildValidSettingsBody({
            enforceShiftGate: true,
            vatEnabled: true,
            vatRatePercent: 12,
            discountPresets: [{ label: "Senior Citizen (20%)", pct: 20 }],
          }),
        });

        const [catRes] = await pool.execute(
          "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
          [categoryName],
        );
        tracker.menuCategoryIds.add(Number(catRes.insertId));

        const prodRes = await server.requestJson("/api/menu", {
          method: "POST",
          token: adminUser.token,
          body: {
            name: `Latte_${tag}`,
            category: categoryName,
            basePrice: 100,
            costPrice: 30,
            stock: 10,
            available: true,
            ingredients: [],
          },
        });
        assert.equal(prodRes.status, 201);
        const prodId = Number(prodRes.data.id);
        tracker.productIds.add(prodId);

        // Blocked when no open shift
        const blockedRes = await server.requestJson("/api/orders", {
          method: "POST",
          token: staffUser.token,
          body: {
            items: [{ productId: prodId, quantity: 1 }],
            paymentMethod: "Cash",
            cashTendered: 200,
          },
        });
        assert.equal(blockedRes.status, 409);

        // Open shift for staffUser
        const openRes = await server.requestJson("/api/sessions/open", {
          method: "POST",
          token: staffUser.token,
          body: { openingFloat: 500, terminalLabel: "Counter Test" },
        });
        assert.equal(openRes.status, 201);
        tracker.sessionIds.add(Number(openRes.data.id));

        // Place order with Senior Citizen (20%) preset + 12% VAT on discounted net
        // subtotal = 100, discount = 20, net = 80, vat = 9.60, total = 89.60
        const orderRes = await server.requestJson("/api/orders", {
          method: "POST",
          token: staffUser.token,
          body: {
            items: [{ productId: prodId, quantity: 1 }],
            paymentMethod: "Cash",
            cashTendered: 100,
            discountLabel: "Senior Citizen (20%)",
          },
        });
        assert.equal(orderRes.status, 201);
        const orderNumber = orderRes.data.id;
        const [[dbOrder]] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [orderNumber]);
        orderId = Number(dbOrder.id);
        tracker.orderIds.add(orderId);

        assert.equal(Number(orderRes.data.subtotal), 100);
        assert.equal(Number(orderRes.data.discountAmount), 20);
        assert.equal(orderRes.data.discountLabel, "Senior Citizen (20%)");
        assert.equal(Number(orderRes.data.taxAmount), 9.6);
        assert.equal(Number(orderRes.data.total), 89.6);

        // Verify double-entry journal lines for sales_revenue balance & hit 1010/4020/4010/2020
        const [saleLines] = await pool.execute(
          `SELECT coa.account_code, jel.debit, jel.credit
             FROM journal_entries je
             JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
             JOIN chart_of_accounts coa ON coa.id = jel.account_id
            WHERE je.order_id = ? AND je.entry_type = 'sales_revenue'`,
          [orderId],
        );
        assert.ok(saleLines.length >= 4);
        const sumDebit = saleLines.reduce((s, r) => s + Number(r.debit), 0);
        const sumCredit = saleLines.reduce((s, r) => s + Number(r.credit), 0);
        assert.ok(Math.abs(sumDebit - sumCredit) < 0.005);
        assert.ok(saleLines.some((r) => r.account_code === "4020" && Number(r.debit) === 20));
        assert.ok(saleLines.some((r) => r.account_code === "2020" && Number(r.credit) === 9.6));

        // Void order and verify stock restore + void reversal entry balance
        const voidRes = await server.requestJson(`/api/orders/${orderNumber}/void`, {
          method: "POST",
          token: adminUser.token,
          body: { reason: "Wave 3 verification void", restoreStock: true },
        });
        assert.equal(voidRes.status, 200);
        assert.equal(voidRes.data.status, "Cancelled");

        const menuAfterVoid = await server.requestJson("/api/menu?all=true", { token: adminUser.token });
        assert.equal(menuAfterVoid.status, 200);
        const restoredItem = menuAfterVoid.data.find((p) => Number(p.id) === prodId);
        assert.equal(Number(restoredItem.stock), 10);
      } finally {
        if (orderId) {
          await pool.execute(
            `DELETE jel FROM journal_entry_lines jel
               JOIN journal_entries je ON je.id = jel.journal_entry_id
              WHERE je.order_id = ?`,
            [orderId],
          );
          await pool.execute("UPDATE journal_entries SET reverses_entry_id = NULL WHERE order_id = ?", [orderId]);
          await pool.execute("DELETE FROM journal_entries WHERE order_id = ?", [orderId]);
        }
        await tracker.restoreBusinessSettings();
      }
    });
  });
});
