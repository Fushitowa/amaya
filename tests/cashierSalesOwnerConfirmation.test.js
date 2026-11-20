import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function round2(val) {
  return Number((Number(val) || 0).toFixed(2));
}

describe("Tala Suite: Cashier Sales Remittance & Owner Confirmation Gate on Store Total Asset Value", () => {
  let server;
  let adminUser;
  let staffUser;
  let ingredientId;
  let productId;
  let productName;
  let baselineSummary;
  let firstOrderNumber;
  let firstOrderItemId;
  const orderTotal = 100.0;
  const ingredientCostPerUnit = 20.0;

  const tracker = createCleanupTracker();

  before(async () => {
    server = await startTestServer({ unlockNetIncome: true });
    const tag = makeUniqueTag("OwnerConfirm");

    adminUser = await tracker.createUser({
      role: "admin",
      displayName: `Tala Owner ${tag}`,
      username: makeUniqueTag("tala_owner_admin").toLowerCase(),
      password: `AdminPass_${tag}`,
    });

    staffUser = await tracker.createUser({
      role: "staff",
      displayName: `Tala Cashier ${tag}`,
      username: "staff",
      password: `StaffPass_${tag}`,
    });

    // Create costed inventory ingredient: 50 pcs @ ₱20.00 each (total ₱1,000.00)
    const invRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: adminUser.token,
      body: {
        item: `Confirm Cup ${tag}`,
        category: "Cups & Lids",
        quantity: 50,
        unit: "pcs",
        purchasePrice: 1000,
        packageQuantity: 1,
        contentsPerPackage: 50,
      },
    });
    assert.equal(invRes.status, 201, `Expected 201 creating inventory item, got ${invRes.status}: ${invRes.text}`);
    ingredientId = Number(invRes.data.id);
    tracker.inventoryItemIds.add(ingredientId);

    const [catRes] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'drink')",
      [`Confirm_Cat_${tag}`]
    );
    tracker.menuCategoryIds.add(Number(catRes.insertId));

    productName = `Confirm Signature Latte ${tag}`;
    const prodRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: adminUser.token,
      body: {
        name: productName,
        category: `Confirm_Cat_${tag}`,
        price: "100.00",
        stock: 0,
        sizes: [
          {
            label: "Regular",
            price: 100,
            ingredients: [
              {
                inventoryItemId: ingredientId,
                name: `Confirm Cup ${tag}`,
                quantityUsed: 1,
                unit: "pcs",
                stockUnit: "pcs",
              },
            ],
          },
        ],
        ingredients: [
          {
            inventoryItemId: ingredientId,
            name: `Confirm Cup ${tag}`,
            quantityUsed: 1,
            unit: "pcs",
            stockUnit: "pcs",
          },
        ],
      },
    });
    assert.equal(prodRes.status, 201, `Expected 201 creating menu product, got ${prodRes.status}: ${prodRes.text}`);
    productId = Number(prodRes.data.id);
    tracker.productIds.add(productId);
  });

  after(async () => {
    try {
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  it("Test 1 (Unconfirmed Counter Cash Gate on GET /api/finances/accounts): holds unconfirmed cashier counter cash out of totalStoreAssets until Owner confirms", async () => {
    // 1. Record baseline GET /api/finances/accounts
    const baseRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(baseRes.status, 200);
    baselineSummary = baseRes.data.summary;

    // 2. As staff cashier user, place a paid Cash order (₱100.00 using 1x ₱20.00 inventory ingredient)
    const orderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staffUser.token,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        cashTendered: 100,
        customerName: "Walk-in Unconfirmed Test",
        items: [{ productId, size: "Regular", quantity: 1 }],
      },
    });
    assert.equal(orderRes.status, 201, `Expected 201 placing order, got ${orderRes.status}: ${orderRes.text}`);
    firstOrderNumber = orderRes.data.id;
    firstOrderItemId = Number(orderRes.data.items?.[0]?.id);
    assert.ok(firstOrderNumber, "Order number must be returned");
    assert.ok(firstOrderItemId > 0, "Order item id must be returned");

    assert.equal(
      typeof baselineSummary.unconfirmedCounterCash,
      "number",
      "GET /api/finances/accounts summary must expose numeric unconfirmedCounterCash"
    );
    assert.equal(
      typeof baselineSummary.confirmedCashDrawer,
      "number",
      "GET /api/finances/accounts summary must expose numeric confirmedCashDrawer"
    );

    // 3. Assert the returned order has ownerConfirmed === false and ownerConfirmedAt === null
    assert.equal(
      orderRes.data.ownerConfirmed,
      false,
      "New cashier order must start with ownerConfirmed === false"
    );
    assert.equal(
      orderRes.data.ownerConfirmedAt,
      null,
      "New cashier order must start with ownerConfirmedAt === null"
    );

    // 4. Fetch GET /api/finances/accounts after the sale
    const afterSaleRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(afterSaleRes.status, 200);
    const afterSummary = afterSaleRes.data.summary;

    // summary.cashDrawer increased by +orderTotal (+100.00)
    assert.equal(
      round2(afterSummary.cashDrawer - baselineSummary.cashDrawer),
      orderTotal,
      `cashDrawer must increase by +${orderTotal}`
    );

    // summary.unconfirmedCounterCash increased by +orderTotal (+100.00)
    assert.equal(
      round2(afterSummary.unconfirmedCounterCash - baselineSummary.unconfirmedCounterCash),
      orderTotal,
      `unconfirmedCounterCash must increase by +${orderTotal}`
    );

    // summary.confirmedCashDrawer (round2(cashDrawer - unconfirmedCounterCash)) did NOT increase (+0.00 change)
    assert.equal(
      round2(afterSummary.confirmedCashDrawer),
      round2(afterSummary.cashDrawer - afterSummary.unconfirmedCounterCash),
      "confirmedCashDrawer must equal round2(cashDrawer - unconfirmedCounterCash)"
    );
    assert.equal(
      round2(afterSummary.confirmedCashDrawer - baselineSummary.confirmedCashDrawer),
      0.0,
      "confirmedCashDrawer must NOT increase before Owner confirmation"
    );

    // Ingredient stock was deducted (-20.00 from liveInventoryValue)
    assert.equal(
      round2(baselineSummary.liveInventoryValue - afterSummary.liveInventoryValue),
      ingredientCostPerUnit,
      `liveInventoryValue must reflect ingredient deduction of ${ingredientCostPerUnit}`
    );

    // summary.totalStoreAssets equals round2(confirmedCashDrawer + gcash + bank + reserve + liveInventoryValue + nonCurrentEquipment)
    const expectedGatedTotalAssets = round2(
      afterSummary.confirmedCashDrawer +
        afterSummary.gcash +
        afterSummary.bank +
        afterSummary.reserve +
        afterSummary.liveInventoryValue +
        afterSummary.nonCurrentEquipment
    );
    assert.equal(
      round2(afterSummary.totalStoreAssets),
      expectedGatedTotalAssets,
      "totalStoreAssets must exclude unconfirmedCounterCash before Owner confirmation"
    );
  });

  it("Test 2 (Cashier Sales & Product Breakdown Visibility): exposes unconfirmed order counts, cash totals, productBreakdown, and ownerConfirmed status in staff reports", async () => {
    // 1. Fetch GET /api/reports/staff-performance?rangeKey=all
    const perfRes = await server.requestJson("/api/reports/staff-performance?rangeKey=all", {
      token: adminUser.token,
    });
    assert.equal(perfRes.status, 200);
    const cashierPerf = perfRes.data.staff.find((s) => Number(s.userId) === Number(staffUser.id));
    assert.ok(cashierPerf, "Cashier must appear in staff-performance report");
    assert.ok(
      Number(cashierPerf.unconfirmedOrdersCount) >= 1,
      `Expected cashierPerf.unconfirmedOrdersCount >= 1, got ${cashierPerf.unconfirmedOrdersCount}`
    );
    assert.ok(
      Number(cashierPerf.unconfirmedSales) >= orderTotal,
      `Expected cashierPerf.unconfirmedSales >= ${orderTotal}, got ${cashierPerf.unconfirmedSales}`
    );
    assert.ok(
      Number(cashierPerf.unconfirmedCashSales) >= orderTotal,
      `Expected cashierPerf.unconfirmedCashSales >= ${orderTotal}, got ${cashierPerf.unconfirmedCashSales}`
    );

    // 2. Fetch GET /api/reports/staff/:id/activity?rangeKey=all
    const actRes = await server.requestJson(`/api/reports/staff/${staffUser.id}/activity?rangeKey=all`, {
      token: adminUser.token,
    });
    assert.equal(actRes.status, 200);
    assert.ok(
      Number(actRes.data.summary?.unconfirmedOrdersCount) >= 1,
      "activity summary.unconfirmedOrdersCount must be >= 1"
    );
    assert.ok(
      Number(actRes.data.summary?.unconfirmedSales) >= orderTotal,
      `activity summary.unconfirmedSales must be >= ${orderTotal}`
    );
    assert.ok(
      Number(actRes.data.summary?.unconfirmedCashSales) >= orderTotal,
      `activity summary.unconfirmedCashSales must be >= ${orderTotal}`
    );

    const soldProduct = actRes.data.productBreakdown?.find(
      (p) => Number(p.productId) === productId || p.productName === productName
    );
    assert.ok(soldProduct, "productBreakdown must contain the sold product");
    assert.equal(Number(soldProduct.unitsSold), 1);
    assert.equal(round2(soldProduct.sales), orderTotal);

    const activityOrder = actRes.data.orders?.items?.find((o) => o.id === firstOrderNumber);
    assert.ok(activityOrder, "orders.items must include the cashier's order");
    assert.equal(
      activityOrder.ownerConfirmed,
      false,
      "activity order row must show ownerConfirmed === false prior to Owner confirmation"
    );
  });

  it("Test 3 (Zero-Trust RBAC Guard on Confirmation): blocks staff from confirming their own or any cashier sales with HTTP 403", async () => {
    const staffConfirmRes = await server.requestJson(
      `/api/reports/staff/${staffUser.id}/confirm-sales`,
      {
        method: "POST",
        token: staffUser.token,
        body: { note: "Staff attempting self-confirmation" },
      }
    );
    assert.equal(
      staffConfirmRes.status,
      403,
      `Staff calling POST /api/reports/staff/:id/confirm-sales must be blocked with HTTP 403, got ${staffConfirmRes.status}`
    );
  });

  it("Test 4 (Owner Confirmation Releases Counter Cash into totalStoreAssets, Idempotency & Post-Confirm Tamper Guard)", async () => {
    // Capture pre-confirm accounts summary
    const preConfirmAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(preConfirmAccRes.status, 200);
    const preSummary = preConfirmAccRes.data.summary;

    // 1. Call POST /api/reports/staff/:id/confirm-sales using adminUser.token (the Owner)
    const confirmRes = await server.requestJson(
      `/api/reports/staff/${staffUser.id}/confirm-sales`,
      {
        method: "POST",
        token: adminUser.token,
        body: { note: "Owner verified counter cash and product sales" },
      }
    );
    assert.equal(
      confirmRes.status,
      200,
      `Expected HTTP 200 from confirm-sales, got ${confirmRes.status}: ${confirmRes.text}`
    );
    assert.equal(confirmRes.data.alreadyConfirmed, false);
    assert.ok(Number(confirmRes.data.confirmedOrdersCount) >= 1);
    assert.ok(Number(confirmRes.data.confirmedCashTotal) >= orderTotal);
    const confirmedCashTotal = round2(confirmRes.data.confirmedCashTotal);

    // 2. Fetch GET /api/finances/accounts after Owner confirmation
    const postConfirmAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(postConfirmAccRes.status, 200);
    const postSummary = postConfirmAccRes.data.summary;

    // unconfirmedCounterCash decreased by confirmedCashTotal (back to baseline)
    assert.equal(
      round2(preSummary.unconfirmedCounterCash - postSummary.unconfirmedCounterCash),
      confirmedCashTotal,
      "unconfirmedCounterCash must decrease by confirmedCashTotal"
    );
    assert.equal(
      round2(postSummary.unconfirmedCounterCash),
      round2(baselineSummary.unconfirmedCounterCash),
      "unconfirmedCounterCash must return to baseline after confirming cashier sales"
    );

    // confirmedCashDrawer increased by +confirmedCashTotal
    assert.equal(
      round2(postSummary.confirmedCashDrawer - preSummary.confirmedCashDrawer),
      confirmedCashTotal,
      "confirmedCashDrawer must increase by +confirmedCashTotal"
    );

    // totalStoreAssets increased by +confirmedCashTotal (now completely added into total store assets alongside liveInventoryValue!)
    assert.equal(
      round2(postSummary.totalStoreAssets - preSummary.totalStoreAssets),
      confirmedCashTotal,
      "totalStoreAssets must increase by +confirmedCashTotal upon Owner confirmation"
    );

    // Accounting identity: round2(baseCapitalMoney + netProfitAfterSale) === round2(totalStoreAssets)
    assert.equal(
      round2(postSummary.baseCapitalMoney + postSummary.netProfitAfterSale),
      round2(postSummary.totalStoreAssets),
      "baseCapitalMoney + netProfitAfterSale must equal totalStoreAssets"
    );

    // /api/finances/trial-balance has isBalanced === true
    const tbRes = await server.requestJson("/api/finances/trial-balance", {
      token: adminUser.token,
    });
    assert.equal(tbRes.status, 200);
    assert.equal(tbRes.data.isBalanced, true, "Trial balance must remain balanced");

    // 3. Call POST /api/reports/staff/:id/confirm-sales a second time -> idempotent
    const secondConfirmRes = await server.requestJson(
      `/api/reports/staff/${staffUser.id}/confirm-sales`,
      {
        method: "POST",
        token: adminUser.token,
      }
    );
    assert.equal(secondConfirmRes.status, 200);
    assert.equal(secondConfirmRes.data.alreadyConfirmed, true);
    assert.equal(Number(secondConfirmRes.data.confirmedOrdersCount), 0);

    const afterSecondConfirmAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(
      round2(afterSecondConfirmAccRes.data.summary.totalStoreAssets),
      round2(postSummary.totalStoreAssets),
      "Second confirmation call must be idempotent and never double-count totalStoreAssets"
    );

    // 4. Attempt POST /api/orders/:orderNumber/items/:orderItemId/revert as staffUser without admin credentials on the now owner-confirmed order -> HTTP 403
    const tamperRevertRes = await server.requestJson(
      `/api/orders/${firstOrderNumber}/items/${firstOrderItemId}/revert`,
      {
        method: "POST",
        token: staffUser.token,
        body: {
          reason: "Staff trying to revert owner-confirmed sale without admin password",
          restoreStock: true,
        },
      }
    );
    assert.equal(
      tamperRevertRes.status,
      403,
      `Reverting an item on an owner-confirmed order as staff without admin auth must return 403, got ${tamperRevertRes.status}`
    );
  });

  it("Test 5 (Void Self-Healing Before Confirmation): voiding an unconfirmed Cash order returns unconfirmedCounterCash to 0.00 and keeps totalStoreAssets accurate", async () => {
    const beforeOrder2Res = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(beforeOrder2Res.status, 200);
    const beforeOrder2Summary = beforeOrder2Res.data.summary;

    // 1. Place a new Cash order as staffUser (ownerConfirmed === false)
    const order2Res = await server.requestJson("/api/orders", {
      method: "POST",
      token: staffUser.token,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        cashTendered: 100,
        customerName: "Void Before Confirm Customer",
        items: [{ productId, size: "Regular", quantity: 1 }],
      },
    });
    assert.equal(order2Res.status, 201);
    const order2Number = order2Res.data.id;
    assert.equal(order2Res.data.ownerConfirmed, false);

    // 2. Verify unconfirmedCounterCash increased by +100.00
    const midAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(midAccRes.status, 200);
    assert.equal(
      round2(midAccRes.data.summary.unconfirmedCounterCash - beforeOrder2Summary.unconfirmedCounterCash),
      orderTotal,
      "unconfirmedCounterCash must increase by orderTotal while order is active and unconfirmed"
    );

    // 3. Void order2 via POST /api/orders/:order2Number/void (restoreStock: true)
    const voidRes = await server.requestJson(`/api/orders/${order2Number}/void`, {
      method: "POST",
      token: adminUser.token,
      body: {
        reason: "Customer cancelled unconfirmed order",
        restoreStock: true,
      },
    });
    assert.equal(voidRes.status, 200);
    assert.equal(voidRes.data.status, "Cancelled");

    // 4. Verify unconfirmedCounterCash returns to baseline and totalStoreAssets remains accurate
    const afterVoidAccRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(afterVoidAccRes.status, 200);
    const afterVoidSummary = afterVoidAccRes.data.summary;

    assert.equal(
      round2(afterVoidSummary.unconfirmedCounterCash),
      round2(beforeOrder2Summary.unconfirmedCounterCash),
      "unconfirmedCounterCash must self-heal back to baseline after voiding unconfirmed order"
    );
    assert.equal(
      round2(afterVoidSummary.totalStoreAssets),
      round2(beforeOrder2Summary.totalStoreAssets),
      "totalStoreAssets must remain identical after voiding unconfirmed order with stock restored"
    );
  });

  it("Test 6 (Store Total Money Hero Excludes Unsold Live Inventory & Unconfirmed Counter Cash)", async () => {
    // 1. Capture baseline GET /api/finances/accounts
    const beforeRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(beforeRes.status, 200);
    const beforeSummary = beforeRes.data.summary;

    assert.equal(
      typeof beforeSummary.totalConfirmedMoney,
      "number",
      "GET /api/finances/accounts summary must expose numeric totalConfirmedMoney"
    );

    const expectedBeforeConfirmedMoney = round2(
      beforeSummary.confirmedCashDrawer +
        beforeSummary.gcash +
        beforeSummary.bank +
        beforeSummary.reserve
    );
    assert.equal(
      round2(beforeSummary.totalConfirmedMoney),
      expectedBeforeConfirmedMoney,
      "summary.totalConfirmedMoney must equal round2(confirmedCashDrawer + gcash + bank + reserve), strictly excluding liveInventoryValue and nonCurrentEquipment"
    );
    assert.ok(
      Number(beforeSummary.liveInventoryValue) > 0,
      "liveInventoryValue must be positive to prove unsold stock is excluded from totalConfirmedMoney"
    );
    assert.notEqual(
      round2(beforeSummary.totalConfirmedMoney),
      round2(beforeSummary.totalStoreAssets),
      "totalConfirmedMoney must NOT include unsold liveInventoryValue"
    );

    // 2. Cashier places a paid Cash order that consumes an ingredient from liveInventoryValue
    const order3Res = await server.requestJson("/api/orders", {
      method: "POST",
      token: staffUser.token,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        cashTendered: 100,
        customerName: "Total Confirmed Money Gate Customer",
        items: [{ productId, size: "Regular", quantity: 1 }],
      },
    });
    assert.equal(order3Res.status, 201);
    assert.equal(order3Res.data.ownerConfirmed, false);

    // 3. Before Owner confirmation: totalConfirmedMoney does NOT change (+0.00)
    const midRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(midRes.status, 200);
    const midSummary = midRes.data.summary;

    assert.equal(
      round2(midSummary.totalConfirmedMoney - beforeSummary.totalConfirmedMoney),
      0.0,
      "summary.totalConfirmedMoney must NOT change (+0.00) before Owner confirmation"
    );
    assert.equal(
      round2(midSummary.totalConfirmedMoney),
      round2(
        midSummary.confirmedCashDrawer +
          midSummary.gcash +
          midSummary.bank +
          midSummary.reserve
      ),
      "summary.totalConfirmedMoney must still strictly exclude liveInventoryValue and unconfirmedCounterCash"
    );

    // 4. Owner confirms cashier's sales -> totalConfirmedMoney increases by exact confirmedCashTotal (still excluding liveInventoryValue)
    const confirmRes = await server.requestJson(
      `/api/reports/staff/${staffUser.id}/confirm-sales`,
      {
        method: "POST",
        token: adminUser.token,
        body: { note: "Owner confirms Test 6 cashier sales" },
      }
    );
    assert.equal(confirmRes.status, 200);
    const confirmedCashTotal = round2(confirmRes.data.confirmedCashTotal);
    assert.equal(confirmedCashTotal, orderTotal);

    const afterConfirmRes = await server.requestJson("/api/finances/accounts", {
      token: adminUser.token,
    });
    assert.equal(afterConfirmRes.status, 200);
    const afterConfirmSummary = afterConfirmRes.data.summary;

    assert.equal(
      round2(afterConfirmSummary.totalConfirmedMoney - beforeSummary.totalConfirmedMoney),
      confirmedCashTotal,
      "summary.totalConfirmedMoney must increase by exact confirmedCashTotal after Owner confirmation"
    );
    assert.equal(
      round2(afterConfirmSummary.totalConfirmedMoney),
      round2(
        afterConfirmSummary.confirmedCashDrawer +
          afterConfirmSummary.gcash +
          afterConfirmSummary.bank +
          afterConfirmSummary.reserve
      ),
      "summary.totalConfirmedMoney after confirmation must still strictly exclude unsold liveInventoryValue and nonCurrentEquipment"
    );

    // 5. Static UI check on src/components/StoreAssetsHeroCard.jsx
    const heroCardPath = path.resolve(__dirname, "../src/components/StoreAssetsHeroCard.jsx");
    const heroCardSrc = fs.readFileSync(heroCardPath, "utf8");
    const totalAmountBlockMatch = heroCardSrc.match(
      /<span className="store-assets-total-amount">([\s\S]*?)<\/span>/
    );
    assert.ok(totalAmountBlockMatch, "StoreAssetsHeroCard.jsx must contain .store-assets-total-amount");
    const totalAmountInner = totalAmountBlockMatch[1];
    assert.ok(
      totalAmountInner.includes("summary.totalConfirmedMoney"),
      "StoreAssetsHeroCard.jsx .store-assets-total-amount must render summary.totalConfirmedMoney"
    );
    assert.ok(
      !totalAmountInner.includes("summary.totalStoreAssets"),
      "StoreAssetsHeroCard.jsx .store-assets-total-amount must NOT render summary.totalStoreAssets so unsold Live Inventory is never added to the main hero total"
    );
  });
});
