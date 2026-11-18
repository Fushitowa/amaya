import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { round2 } from "../shared/units.js";
import { getManilaTodayDateStr } from "../shared/manilaDate.js";
import {
  addDaysIsoDate,
  allocateRestockBudget,
  buildRestockSummary,
  computeRestockItemPlan,
  sortRestockSuggestions,
} from "../shared/restockSuggestion.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

describe("Smart Restock & Budget-Aware Purchase Suggestion Engine (v2)", () => {
  let server;
  const tracker = createCleanupTracker();

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    try {
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  it("handles missing unit_cost & missing maximum_stock (0 velocity), new-item 2-day observedDays, pack rounding, and out-of-stock floors", () => {
    const today = "2026-11-19";
    const windowStart = addDaysIsoDate(today, -13); // 14-day window

    // 1. Missing unit_cost & missing maximum_stock, 0 velocity
    const uncostedZeroMax = computeRestockItemPlan({
      item: {
        id: 101,
        name: "Uncosted Syrup",
        category: "Syrups",
        unit: "ml",
        quantity: 0,
        maximum_stock: null,
        unit_cost: 0,
        purchase_price: 0,
        contents_per_package: 1,
        created_at: "2026-10-01 09:00:00",
      },
      totalConsumed: 0,
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    assert.equal(uncostedZeroMax.costKnown, false);
    assert.equal(uncostedZeroMax.estimatedCost, null);
    assert.equal(uncostedZeroMax.basis, "fallback");
    assert.equal(uncostedZeroMax.lowData, true);
    assert.equal(uncostedZeroMax.suggestedBuyQty, 0);
    assert.equal(uncostedZeroMax.shouldInclude, true);

    // 2. New item created yesterday (2 inclusive Manila days: 2026-11-18 & 2026-11-19) consuming 20 pcs
    const twoDayItem = computeRestockItemPlan({
      item: {
        id: 102,
        name: "Fresh Croissant",
        category: "Pastries",
        unit: "pcs",
        quantity: 5,
        maximum_stock: 30,
        unit_cost: 25,
        purchase_price: 25,
        contents_per_package: 1,
        created_at: "2026-11-18 08:00:00",
      },
      totalConsumed: 20,
      ordersUsingCount: 12,
      activeSaleDays: 2,
      firstConsumptionAt: "2026-11-18 09:00:00",
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    assert.equal(twoDayItem.observedDays, 2);
    assert.equal(twoDayItem.avgDailyUsage, 10);
    assert.equal(twoDayItem.lowData, true);
    assert.equal(twoDayItem.basis, "velocity");
    assert.equal(twoDayItem.daysOfStockLeft, 0.5);
    assert.equal(twoDayItem.suggestedBuyQty, 65); // (10 * 7) - 5 = 65
    assert.equal(twoDayItem.exceedsMaxStock, true); // 5 + 65 = 70 > 30
    assert.equal(twoDayItem.estimatedCost, 1625);

    // 3. Pack rounding (contents_per_package = 20, purchase_price = 62) + discrete vs continuous rounding
    const packedBuns = computeRestockItemPlan({
      item: {
        id: 103,
        name: "Burger Bun",
        category: "Burger",
        unit: "pcs",
        quantity: 8,
        maximum_stock: 20,
        unit_cost: 3.1,
        purchase_price: 62,
        contents_per_package: 20,
        package_unit: "pack",
        created_at: "2026-10-01 08:00:00",
      },
      totalConsumed: 224,
      ordersUsingCount: 112,
      activeSaleDays: 10,
      firstConsumptionAt: "2026-11-06 08:00:00",
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    assert.equal(packedBuns.isDiscreteUnit, true);
    assert.equal(packedBuns.avgDailyUsage, 16);
    assert.equal(packedBuns.daysOfStockLeft, 0.5);
    assert.equal(packedBuns.suggestedBuyQty, 104); // 16*7 - 8
    assert.equal(packedBuns.estimatedCost, 322.4);
    assert.equal(packedBuns.recommendedPacks, 6); // ceil(104/20)
    assert.equal(packedBuns.packTotalQty, 120);
    assert.equal(packedBuns.packEstimatedCost, 372);
    assert.equal(packedBuns.exceedsMaxStock, true);

    // 4. Discrete fractional round-up vs continuous decimal preservation + out-of-stock floor
    const discreteFractional = computeRestockItemPlan({
      item: {
        id: 104,
        name: "Bottle Syrup",
        unit: "bottle",
        quantity: 1,
        maximum_stock: 10,
        unit_cost: 120,
        created_at: "2026-10-01 00:00:00",
      },
      totalConsumed: 3, // 3/14 = 0.214286/day -> 7d = 1.5 -> need 0.5 -> ceil = 1
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    assert.equal(discreteFractional.isDiscreteUnit, true);
    assert.equal(discreteFractional.suggestedBuyQty, 1);

    const continuousGrams = computeRestockItemPlan({
      item: {
        id: 105,
        name: "Matcha Powder",
        unit: "g",
        quantity: 100,
        maximum_stock: 500,
        unit_cost: 2.5,
        created_at: "2026-10-01 00:00:00",
      },
      totalConsumed: 280, // 20g/day -> 7d = 140g -> need 40g
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    assert.equal(continuousGrams.isDiscreteUnit, false);
    assert.equal(continuousGrams.suggestedBuyQty, 40);

    // Out-of-stock with tiny velocity still gets minimum 1 discrete floor (not 0, not blind max)
    const zeroQtySlow = computeRestockItemPlan({
      item: {
        id: 106,
        name: "Paper Cup 16oz",
        unit: "pcs",
        quantity: 0,
        maximum_stock: 500,
        unit_cost: 2,
        created_at: "2026-10-01 00:00:00",
      },
      totalConsumed: 0.000001,
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    assert.equal(zeroQtySlow.suggestedBuyQty, 1);
  });

  it("enforces pure budget allocation edge cases (exact fit, zero budget, tiny budget skipping, two-pass survival, pack mode, and summary parity)", () => {
    const today = "2026-11-19";
    const windowStart = addDaysIsoDate(today, -13);

    const itemExpensive = computeRestockItemPlan({
      item: { id: 1, name: "Whole Milk Box", unit: "box", quantity: 0, maximum_stock: 10, unit_cost: 500, created_at: "2026-10-01 00:00:00" },
      totalConsumed: 14, // 1/day -> 7 boxes needed = 3500
      ordersUsingCount: 10,
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    const itemSmall = computeRestockItemPlan({
      item: { id: 2, name: "Straw", unit: "pcs", quantity: 0, maximum_stock: 100, unit_cost: 2, created_at: "2026-10-01 00:00:00" },
      totalConsumed: 70, // 5/day -> 35 pcs needed = 70
      ordersUsingCount: 5,
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    const itemUncosted = computeRestockItemPlan({
      item: { id: 3, name: "Mystery Spice", unit: "g", quantity: 0, maximum_stock: null, unit_cost: 0, created_at: "2026-10-01 00:00:00" },
      totalConsumed: 0,
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });

    const ranked = sortRestockSuggestions([itemUncosted, itemSmall, itemExpensive]);
    const summary = buildRestockSummary(ranked);
    assert.equal(summary.totalItemsCount, 3);
    assert.equal(summary.costedItemsCount, 2);
    assert.equal(summary.uncostedItemsCount, 1);
    assert.equal(summary.totalEstimatedCost, round2(itemExpensive.estimatedCost + itemSmall.estimatedCost));

    // 1. budget === 0 -> skipped_budget / uncosted, zero spend
    const zeroAlloc = allocateRestockBudget(ranked, 0);
    assert.equal(zeroAlloc.allocatedTotalCost, 0);
    assert.equal(zeroAlloc.budgetRemaining, 0);
    assert.equal(zeroAlloc.items.find((i) => i.id === 1).allocationStatus, "skipped_budget");
    assert.equal(zeroAlloc.items.find((i) => i.id === 2).allocationStatus, "skipped_budget");
    assert.equal(zeroAlloc.items.find((i) => i.id === 3).allocationStatus, "uncosted");

    // 2. budget === exact lineCost of itemSmall (70), which is smaller than itemExpensive's 1-unit cost (500):
    // Allocator MUST skip #1 cleanly and still fund #2 completely!
    const exactSmallAlloc = allocateRestockBudget(ranked, 70);
    const smallRes = exactSmallAlloc.items.find((i) => i.id === 2);
    const expRes = exactSmallAlloc.items.find((i) => i.id === 1);
    assert.equal(expRes.allocatedQty, 0);
    assert.equal(expRes.allocationStatus, "skipped_budget");
    assert.equal(smallRes.allocatedQty, 35);
    assert.equal(smallRes.allocatedCost, 70);
    assert.equal(smallRes.allocationStatus, "full");
    assert.equal(exactSmallAlloc.allocatedTotalCost, 70);
    assert.equal(exactSmallAlloc.budgetRemaining, 0);

    // 3. Two-pass survival: budget 510 -> Pass 1 funds 1 box of #1 (500) + 5 straws of #2 (10, 1-day cover), remaining 0!
    const survivalAlloc = allocateRestockBudget(ranked, 510);
    assert.equal(survivalAlloc.items.find((i) => i.id === 1).allocatedQty, 1);
    assert.equal(survivalAlloc.items.find((i) => i.id === 1).allocationStatus, "partial");
    assert.equal(survivalAlloc.items.find((i) => i.id === 2).allocatedQty, 5);
    assert.equal(survivalAlloc.items.find((i) => i.id === 2).allocationStatus, "partial");
    assert.equal(survivalAlloc.allocatedTotalCost, 510);
    assert.equal(survivalAlloc.budgetRemaining, 0);

    // 4. Unconstrained mode (budget null or "")
    const unconstrained = allocateRestockBudget(ranked, "");
    assert.equal(unconstrained.budgetProvided, null);
    assert.equal(unconstrained.budgetRemaining, null);
    assert.equal(unconstrained.items[0].allocationStatus, "unconstrained");
  });

  it("enforces deterministic lexicographic tie-breaking (id ASC) and velocity-only inclusion (>40% stock)", () => {
    const today = "2026-11-19";
    const windowStart = addDaysIsoDate(today, -13);

    const tieB = computeRestockItemPlan({
      item: { id: 20, name: "Item B", unit: "pcs", quantity: 4, maximum_stock: 20, unit_cost: 10, created_at: "2026-10-01 00:00:00" },
      totalConsumed: 28, // 2/day -> 2d left, 10 orders
      ordersUsingCount: 10,
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    const tieA = computeRestockItemPlan({
      item: { id: 10, name: "Item A", unit: "pcs", quantity: 4, maximum_stock: 20, unit_cost: 10, created_at: "2026-10-01 00:00:00" },
      totalConsumed: 28,
      ordersUsingCount: 10,
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });
    // High-burn item above 40% stock (10 of 20 = 50%, 20/day -> 0.5d left < 7d)
    const velocityOnly = computeRestockItemPlan({
      item: { id: 30, name: "Fast Bean", unit: "g", quantity: 10, maximum_stock: 20, unit_cost: 5, created_at: "2026-10-01 00:00:00" },
      totalConsumed: 280, // 20/day
      ordersUsingCount: 50,
      lookbackDays: 14,
      coverDays: 7,
      windowStartDateStr: windowStart,
      todayDateStr: today,
    });

    assert.equal(velocityOnly.healthTone, "moderate");
    assert.equal(velocityOnly.urgencyTier, "velocity_alert");
    assert.equal(velocityOnly.shouldInclude, true);
    assert.equal(velocityOnly.daysOfStockLeft, 0.5);

    const sorted = sortRestockSuggestions([tieB, velocityOnly, tieA]);
    assert.deepEqual(sorted.map((x) => x.id), [10, 20, 30]);
  });

  it("GET /api/reports/restock-suggestions enforces RBAC, validates params, respects Manila-midnight boundaries, excludes voided/cancelled orders, and includes velocity-only items", async () => {
    const tag = makeUniqueTag("Restock");
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    // RBAC checks
    const unauth = await server.requestJson("/api/reports/restock-suggestions");
    assert.equal(unauth.status, 401);

    const staffForbidden = await server.requestJson("/api/reports/restock-suggestions", { token: staff.token });
    assert.equal(staffForbidden.status, 403);

    // Parameter validation -> 400
    const badLookback = await server.requestJson("/api/reports/restock-suggestions?lookbackDays=0", { token: admin.token });
    assert.equal(badLookback.status, 400);
    const badLookbackHigh = await server.requestJson("/api/reports/restock-suggestions?lookbackDays=91", { token: admin.token });
    assert.equal(badLookbackHigh.status, 400);
    const badCover = await server.requestJson("/api/reports/restock-suggestions?coverDays=abc", { token: admin.token });
    assert.equal(badCover.status, 400);
    const badCoverHigh = await server.requestJson("/api/reports/restock-suggestions?coverDays=61", { token: admin.token });
    assert.equal(badCoverHigh.status, 400);

    // Create test inventory items
    const today = getManilaTodayDateStr();
    const lookbackDays = 7;
    const fromDate = addDaysIsoDate(today, -(lookbackDays - 1));
    const beforeWindowDate = addDaysIsoDate(fromDate, -1);

    const invBoundaryRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `Boundary Bun ${tag}`,
        category: "Ingredients",
        quantity: 10, // 50% of max 20 (healthy %!) so only included via velocity!
        unit: "pcs",
        maximumStock: 20,
        purchasePrice: 62,
        packageQuantity: 1,
        contentsPerPackage: 20,
        packageUnit: "pack",
      },
    });
    assert.equal(invBoundaryRes.status, 201);
    const invBoundaryId = Number(invBoundaryRes.data.id);
    tracker.inventoryItemIds.add(invBoundaryId);

    const invUncostedRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `Uncosted Milk ${tag}`,
        category: "Ingredients",
        quantity: 0,
        unit: "ml",
        maximumStock: null,
        purchasePrice: 0,
        packageQuantity: 1,
        contentsPerPackage: 1,
      },
    });
    assert.equal(invUncostedRes.status, 201);
    const invUncostedId = Number(invUncostedRes.data.id);
    tracker.inventoryItemIds.add(invUncostedId);

    // Backdate created_at so observedDays = full 7-day lookback
    await pool.execute(
      "UPDATE inventory_items SET created_at = ? WHERE id IN (?, ?)",
      [`${beforeWindowDate} 08:00:00`, invBoundaryId, invUncostedId],
    );

    // Insert 4 orders in DB:
    // 1. Inside start boundary (`fromDate 00:00:00`): 70 pcs -> counted!
    // 2. Inside end boundary (`today 23:59:59`): 70 pcs -> counted! (Total valid = 140 pcs over 7 days = 20/day)
    // 3. 1 second BEFORE windowStart (`beforeWindowDate 23:59:59`): 500 pcs -> EXCLUDED!
    // 4. Inside window, Cancelled order: 500 pcs -> EXCLUDED!
    // 5. Inside window, Active order with reversed_at NOT NULL consumption: 500 pcs -> EXCLUDED!
    const orderPrefix = `R${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const insertTestOrder = async (suffix, createdAt, status = "Completed") => {
      const [ordRes] = await pool.execute(
        `INSERT INTO orders (order_number, customer_name, order_type, order_status, payment_status, subtotal, total, created_by, created_at)
         VALUES (?, 'Walk-in', 'Counter', ?, 'Paid', 100.00, 100.00, ?, ?)`,
        [`${orderPrefix}-${suffix}`, status, staff.id, createdAt],
      );
      const orderId = Number(ordRes.insertId);
      tracker.orderIds.add(orderId);
      return orderId;
    };

    const o1 = await insertTestOrder("1", `${fromDate} 00:00:00`, "Completed");
    const o2 = await insertTestOrder("2", `${today} 23:59:59`, "Pending");
    const oBefore = await insertTestOrder("3", `${beforeWindowDate} 23:59:59`, "Completed");
    const oCancelled = await insertTestOrder("4", `${today} 12:00:00`, "Cancelled");
    const oReversed = await insertTestOrder("5", `${today} 13:00:00`, "Completed");

    const insertCons = async (orderId, qty, reversedAt = null) => {
      await pool.execute(
        `INSERT INTO order_inventory_consumptions
           (order_id, order_item_id, order_number, product_name_snapshot, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit, reversed_at)
         VALUES (?, NULL, ?, 'Test Prod', ?, ?, ?, 'pcs', ?)`,
        [orderId, `RST-${orderId}`, invBoundaryId, `Boundary Bun ${tag}`, qty, reversedAt],
      );
    };

    await insertCons(o1, 70, null);
    await insertCons(o2, 70, null);
    await insertCons(oBefore, 500, null);
    await insertCons(oCancelled, 500, null);
    await insertCons(oReversed, 500, `${today} 13:05:00`);

    const res = await server.requestJson(`/api/reports/restock-suggestions?lookbackDays=${lookbackDays}&coverDays=7`, {
      token: admin.token,
    });
    assert.equal(res.status, 200, `Unexpected status ${res.status}: ${res.text}`);
    assert.equal(res.data.lookbackDays, 7);
    assert.equal(res.data.coverDays, 7);
    assert.equal(res.data.windowStart, `${fromDate} 00:00:00`);
    assert.equal(res.data.windowEnd, `${today} 23:59:59`);

    const bun = res.data.items.find((i) => i.id === invBoundaryId);
    assert.ok(bun, "Velocity-only item (50% stock, 0.5d left) must be included");
    assert.equal(bun.totalConsumed, 140);
    assert.equal(bun.ordersUsingCount, 2);
    assert.equal(bun.activeSaleDays, 2);
    assert.equal(bun.observedDays, 7);
    assert.equal(bun.avgDailyUsage, 20);
    assert.equal(bun.daysOfStockLeft, 0.5);
    assert.equal(bun.urgencyTier, "velocity_alert");
    assert.equal(bun.suggestedBuyQty, 130); // (20 * 7) - 10 = 130
    assert.equal(bun.estimatedCost, round2(130 * 3.1)); // 403.00
    assert.equal(bun.recommendedPacks, 7); // ceil(130/20)
    assert.equal(bun.packEstimatedCost, 434);
    assert.equal(bun.exceedsMaxStock, true);

    const uncosted = res.data.items.find((i) => i.id === invUncostedId);
    assert.ok(uncosted, "Out-of-stock uncosted item must be included");
    assert.equal(uncosted.costKnown, false);
    assert.equal(uncosted.estimatedCost, null);
    assert.equal(uncosted.basis, "fallback");
    assert.equal(uncosted.lowData, true);
    assert.equal(uncosted.suggestedBuyQty, 0);

    // Out-of-stock item sorts ahead of velocity_alert item
    const uncostedIdx = res.data.items.findIndex((i) => i.id === invUncostedId);
    const bunIdx = res.data.items.findIndex((i) => i.id === invBoundaryId);
    assert.ok(uncostedIdx < bunIdx, "Out of stock item must sort before velocity_alert item");

    // Exact line-sum parity
    const expectedSum = round2(
      res.data.items.reduce((acc, i) => acc + (i.costKnown && i.estimatedCost != null ? i.estimatedCost : 0), 0),
    );
    assert.equal(res.data.summary.totalEstimatedCost, expectedSum);
  });
});
