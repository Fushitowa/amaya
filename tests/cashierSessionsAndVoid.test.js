import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pool from "../api/src/database.js";
import { addCashier, setCashierPassword } from "../api/src/account-manager.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

async function collectFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full));
    } else if (/\.(js|jsx)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe("Tala Suite: Cashier Auth, RBAC, Shared Consumptions, Non-Destructive Void & Shift Sessions", () => {
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

  it("ZERO REFUNDS: verifies no refund endpoints, columns, statuses, or UI handlers exist anywhere", async () => {
    const apiFiles = await collectFiles(path.resolve("api/src"));
    const srcFiles = await collectFiles(path.resolve("src"));
    const testFiles = (await collectFiles(path.resolve("tests")))
      .filter((file) => path.basename(file) !== "cashierSessionsAndVoid.test.js");
    const refundMatches = [];

    for (const file of [...apiFiles, ...srcFiles, ...testFiles]) {
      const content = await fs.readFile(file, "utf-8");
      if (/refund/i.test(content)) {
        refundMatches.push(path.relative(process.cwd(), file));
      }
    }
    assert.deepEqual(refundMatches, [], `No refund logic may exist in api/src, src, or other tests, found: ${refundMatches.join(", ")}`);

    const [orderCols] = await pool.execute("SHOW COLUMNS FROM orders");
    const refundCols = orderCols.filter((c) => /refund/i.test(c.Field));
    assert.deepEqual(refundCols, [], "orders table must have zero refund columns");
    const statusCol = orderCols.find((c) => c.Field === "order_status");
    assert.equal(/refund/i.test(statusCol?.Type || ""), false, "orders.order_status must contain zero refund states");

    const admin = await tracker.createUser({ role: "admin" });
    const refundRes = await server.requestJson("/api/orders/AM-000000000000-000000/refund", {
      method: "POST",
      token: admin.token,
      body: { reason: "No refunds supported" },
    });
    assert.equal(refundRes.status, 404, "Refund endpoint must not exist");
  });

  it("enforces active password collision checks, role min/max byte guards, token revocation, and rename snapshot preservation", async () => {
    const tag = makeUniqueTag("Auth");
    const admin = await tracker.createUser({ role: "admin", password: `Adm_${tag}` });

    // 1. addCashier & POST /api/auth/cashiers validations
    const passA = `CashierA_${tag}`;
    const nameA = `Cashier Alpha ${tag}`;
    const resAddA = await server.requestJson("/api/auth/cashiers", {
      method: "POST",
      token: admin.token,
      body: { displayName: nameA, password: passA },
    });
    assert.equal(resAddA.status, 201);
    tracker.userIds.add(Number(resAddA.data.id));
    const cashierAId = Number(resAddA.data.id);

    // 6-char min & 72-byte cap on addCashier
    await assert.rejects(
      async () => addCashier(`Short_${tag}`, "12345"),
      (err) => err.status === 400 && /at least 6 characters/i.test(err.message),
    );
    await assert.rejects(
      async () => addCashier(`Long_${tag}`, "p".repeat(73)),
      (err) => err.status === 400 && /72 bytes/i.test(err.message),
    );

    // Collision on addCashier
    await assert.rejects(
      async () => addCashier(`DupPass_${tag}`, passA),
      (err) => err.status === 409 && /already assigned to/i.test(err.message),
    );

    // Create Cashier B with unique password
    const passB = `CashierB_${tag}`;
    const nameB = `Cashier Beta ${tag}`;
    const resAddB = await server.requestJson("/api/auth/cashiers", {
      method: "POST",
      token: admin.token,
      body: { displayName: nameB, password: passB },
    });
    assert.equal(resAddB.status, 201);
    tracker.userIds.add(Number(resAddB.data.id));
    const cashierBId = Number(resAddB.data.id);

    // 2. setCashierPassword collision & bounds
    await assert.rejects(
      async () => setCashierPassword(cashierBId, "12345"),
      (err) => err.status === 400 && /at least 6 characters/i.test(err.message),
    );
    await assert.rejects(
      async () => setCashierPassword(cashierBId, "b".repeat(73)),
      (err) => err.status === 400 && /72 bytes/i.test(err.message),
    );
    const putCollision = await server.requestJson(`/api/auth/cashiers/${cashierBId}/password`, {
      method: "PUT",
      token: admin.token,
      body: { password: passA },
    });
    assert.equal(putCollision.status, 409);
    assert.match(putCollision.data.message, /already assigned to/i);

    // Collision against an INACTIVE cashier must also be rejected 409
    const passInactive = `Inactive_${tag}`;
    const inactiveCashier = await tracker.createUser({
      role: "staff",
      displayName: `Inactive Peer ${tag}`,
      password: passInactive,
      isActive: false,
    });
    assert.equal(inactiveCashier.isActive, false);
    const inactiveCollision = await server.requestJson(`/api/auth/cashiers/${cashierBId}/password`, {
      method: "PUT",
      token: admin.token,
      body: { password: passInactive },
    });
    assert.equal(inactiveCollision.status, 409);
    assert.match(inactiveCollision.data.message, /already assigned to/i);

    // 3. POST /api/auth/change-password for staff (6-char min, 72-byte cap, collision 409) & admin (8-char min)
    const loginA = await server.requestJson("/api/auth/login", {
      method: "POST",
      body: { username: "staff", password: passA },
    });
    assert.equal(loginA.status, 200);
    const tokenABefore = loginA.data.token;

    const staffTooShort = await server.requestJson("/api/auth/change-password", {
      method: "POST",
      token: tokenABefore,
      body: { currentPassword: passA, newPassword: "12345" },
    });
    assert.equal(staffTooShort.status, 400);
    assert.match(staffTooShort.data.message, /at least 6 characters/i);

    const staffTooLong = await server.requestJson("/api/auth/change-password", {
      method: "POST",
      token: tokenABefore,
      body: { currentPassword: passA, newPassword: "z".repeat(73) },
    });
    assert.equal(staffTooLong.status, 400);
    assert.match(staffTooLong.data.message, /72 bytes/i);

    const staffCollision = await server.requestJson("/api/auth/change-password", {
      method: "POST",
      token: tokenABefore,
      body: { currentPassword: passA, newPassword: passB },
    });
    assert.equal(staffCollision.status, 409);
    assert.match(staffCollision.data.message, /already assigned to/i);

    const nextPassA = `NextA_${tag}`;
    const staffChanged = await server.requestJson("/api/auth/change-password", {
      method: "POST",
      token: tokenABefore,
      body: { currentPassword: passA, newPassword: nextPassA },
    });
    assert.equal(staffChanged.status, 200);

    // Token version incremented -> old token must be rejected with 401
    const oldTokenCheck = await server.requestJson("/api/auth/me", { token: tokenABefore });
    assert.equal(oldTokenCheck.status, 401);

    // Admin 8-char min guard
    const adminTooShort = await server.requestJson("/api/auth/change-password", {
      method: "POST",
      token: admin.token,
      body: { currentPassword: admin.password, newPassword: "1234567" },
    });
    assert.equal(adminTooShort.status, 400);
    assert.match(adminTooShort.data.message, /at least 8 characters/i);

    const adminTooLong = await server.requestJson("/api/auth/change-password", {
      method: "POST",
      token: admin.token,
      body: { currentPassword: admin.password, newPassword: "a".repeat(73) },
    });
    assert.equal(adminTooLong.status, 400);

    // 4. PUT /api/auth/cashiers/:id rename preserves historical orders.cashier_name
    const loginAAfter = await server.requestJson("/api/auth/login", {
      method: "POST",
      body: { username: "staff", password: nextPassA },
    });
    assert.equal(loginAAfter.status, 200);
    const tokenA = loginAAfter.data.token;

    // Create a synthetic non-recipe menu product for cashier order
    const [mCatRes] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
      [`Cat_${tag}`,],
    );
    tracker.menuCategoryIds.add(Number(mCatRes.insertId));
    const snackRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Snack_${tag}`,
        category: `Cat_${tag}`,
        price: "55.00",
        costPrice: "20.00",
        stock: 10,
        sizes: [{ label: "Regular", price: 55 }],
        ingredients: [],
      },
    });
    assert.equal(snackRes.status, 201);
    tracker.productIds.add(Number(snackRes.data.id));

    const firstOrderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: tokenA,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        customerName: "Rename Historical Check",
        items: [{ productId: snackRes.data.id, size: "Regular", quantity: 1 }],
      },
    });
    assert.equal(firstOrderRes.status, 201);
    const firstOrderNo = firstOrderRes.data.id;
    assert.equal(firstOrderRes.data.cashier, nameA);

    const renamedA = `Cashier Alpha Renamed ${tag}`;
    const renameRes = await server.requestJson(`/api/auth/cashiers/${cashierAId}`, {
      method: "PUT",
      token: admin.token,
      body: { displayName: renamedA },
    });
    assert.equal(renameRes.status, 200);
    assert.equal(renameRes.data.displayName, renamedA);

    const [[historicalRow]] = await pool.execute(
      "SELECT cashier_name FROM orders WHERE order_number = ?",
      [firstOrderNo],
    );
    assert.equal(historicalRow.cashier_name, nameA, "Historical orders.cashier_name snapshot must never mutate on rename");

    const historicalApi = await server.requestJson(`/api/orders/${firstOrderNo}`, { token: admin.token });
    assert.equal(historicalApi.status, 200);
    assert.equal(historicalApi.data.cashier, nameA);

    const secondOrderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: tokenA,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        customerName: "Post Rename Order",
        items: [{ productId: snackRes.data.id, size: "Regular", quantity: 1 }],
      },
    });
    assert.equal(secondOrderRes.status, 201);
    assert.equal(secondOrderRes.data.cashier, renamedA, "Subsequent orders must capture updated cashier display name");
  });

  it("enforces strict RBAC for role='staff' across reports, summaries, movements, and cost stripping", async () => {
    const tag = makeUniqueTag("RBAC");
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    // Create costed inventory & menu item & order so payload fields actually exist to strip
    const invCreate = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `RBAC Syrup ${tag}`,
        category: "Syrups & Purees",
        quantity: 200,
        unit: "ml",
        purchasePrice: 400,
        packageQuantity: 1,
        contentsPerPackage: 200,
      },
    });
    assert.equal(invCreate.status, 201);
    const invId = Number(invCreate.data.id);
    tracker.inventoryItemIds.add(invId);

    const [catRes] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'general')",
      [`RBAC_Cat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(catRes.insertId));

    const prodCreate = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `RBAC Item ${tag}`,
        category: `RBAC_Cat_${tag}`,
        price: "90.00",
        sizes: [{
          label: "Regular",
          price: 90,
          ingredients: [{ inventoryItemId: invId, name: `RBAC Syrup ${tag}`, quantityUsed: 20, unit: "ml", stockUnit: "ml" }],
        }],
        ingredients: [{ inventoryItemId: invId, name: `RBAC Syrup ${tag}`, quantityUsed: 20, unit: "ml", stockUnit: "ml" }],
      },
    });
    assert.equal(prodCreate.status, 201);
    const prodId = Number(prodCreate.data.id);
    tracker.productIds.add(prodId);

    const orderCreate = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "Takeout",
        paymentMethod: "Cash",
        items: [{ productId: prodId, size: "Regular", quantity: 1 }],
      },
    });
    assert.equal(orderCreate.status, 201);
    const orderNo = orderCreate.data.id;

    // 403 checks on admin-only endpoints
    const forbiddenEndpoints = [
      ["GET", "/api/reports/financial-summary"],
      ["GET", "/api/reports/staff-performance"],
      ["GET", `/api/reports/staff/${staff.id}/activity`],
      ["GET", "/api/reports/products"],
      ["GET", "/api/reports/orders"],
      ["GET", "/api/reports/inventory-activity"],
      ["GET", "/api/reports/export.csv?type=orders"],
      ["GET", "/api/orders/summary"],
      ["GET", "/api/inventory/summary"],
      ["GET", "/api/inventory/movements"],
      ["GET", "/api/auth/cashiers"],
      ["POST", `/api/orders/${orderNo}/void`],
    ];

    for (const [method, endpoint] of forbiddenEndpoints) {
      const res = await server.requestJson(endpoint, {
        method,
        token: staff.token,
        body: method === "POST" ? { reason: "Staff attempt" } : undefined,
      });
      assert.equal(res.status, 403, `Expected 403 for staff on ${method} ${endpoint}, got ${res.status}`);
    }

    // Cost stripping on /api/orders and /api/orders/:orderNumber
    const staffOrders = await server.requestJson("/api/orders?limit=20", { token: staff.token });
    assert.equal(staffOrders.status, 200);
    const staffOrder = staffOrders.data.find((o) => o.id === orderNo);
    assert.ok(staffOrder);
    assert.equal(staffOrder.items[0].unitCost, undefined, "Staff /orders must strip unitCost");

    const staffDetail = await server.requestJson(`/api/orders/${orderNo}`, { token: staff.token });
    assert.equal(staffDetail.status, 200);
    assert.equal(staffDetail.data.items[0].unitCost, undefined);
    assert.equal(staffDetail.data.items[0].unitCostSnapshot, undefined);
    assert.equal(staffDetail.data.consumptions, undefined);
    assert.ok(Array.isArray(staffDetail.data.ingredientsUsed));
    assert.equal(staffDetail.data.ingredientsUsed.length, 1);
    assert.equal(typeof staffDetail.data.ingredientsUsed[0].inventoryName, "string");
    assert.ok(staffDetail.data.ingredientsUsed[0].inventoryName.length > 0);
    assert.ok(staffDetail.data.ingredientsUsed[0].quantityUsed > 0);
    assert.equal(typeof staffDetail.data.ingredientsUsed[0].unit, "string");
    assert.equal(staffDetail.data.ingredientsUsed[0].unitCost, undefined);
    assert.equal(staffDetail.data.ingredientsUsed[0].unitCostSnapshot, undefined);
    assert.equal(staffDetail.data.ingredientsUsed[0].lineCost, undefined);
    assert.equal(staffDetail.data.ingredientsUsed[0].totalCost, undefined);

    const adminDetail = await server.requestJson(`/api/orders/${orderNo}`, { token: admin.token });
    assert.equal(adminDetail.status, 200);
    assert.equal(adminDetail.data.items[0].unitCost, 40);
    assert.equal(adminDetail.data.consumptions.length, 1);

    // Cost stripping on /api/menu
    const staffMenu = await server.requestJson("/api/menu?all=true", { token: staff.token });
    assert.equal(staffMenu.status, 200);
    const staffMenuItem = staffMenu.data.find((p) => p.id === prodId);
    assert.ok(staffMenuItem);
    assert.equal(staffMenuItem.costPrice, undefined);
    assert.equal(staffMenuItem.cost, undefined);
    assert.equal(staffMenuItem.grossProfit, undefined);
    assert.equal(staffMenuItem.ingredients[0].unitCost, undefined);
    assert.equal(staffMenuItem.ingredients[0].lineCost, undefined);
    assert.ok(staffMenuItem.ingredients[0].inventoryQuantity >= 0, "Staff still sees operational stock quantity");

    const adminMenu = await server.requestJson("/api/menu?all=true", { token: admin.token });
    const adminMenuItem = adminMenu.data.find((p) => p.id === prodId);
    assert.equal(adminMenuItem.cost, 40);
    assert.equal(adminMenuItem.ingredients[0].unitCost, 2);

    // Cost stripping on /api/inventory & /api/inventory/:id/movements
    const staffInv = await server.requestJson("/api/inventory", { token: staff.token });
    assert.equal(staffInv.status, 200);
    const staffInvItem = staffInv.data.find((i) => i.id === invId);
    assert.ok(staffInvItem);
    assert.equal(staffInvItem.unitCost, undefined);
    assert.equal(staffInvItem.purchasePrice, undefined);
    assert.equal(staffInvItem.inventoryValue, undefined);

    const adminInv = await server.requestJson("/api/inventory", { token: admin.token });
    const adminInvItem = adminInv.data.find((i) => i.id === invId);
    assert.equal(adminInvItem.unitCost, 2);
    assert.equal(adminInvItem.inventoryValue, 360);

    const staffMov = await server.requestJson(`/api/inventory/${invId}/movements`, { token: staff.token });
    assert.equal(staffMov.status, 200);
    assert.ok(staffMov.data.length > 0);
    assert.equal(staffMov.data[0].batchCost, undefined);
    assert.equal(staffMov.data[0].unitCostBefore, undefined);
    assert.equal(staffMov.data[0].unitCostAfter, undefined);
  });

  it("records shared recipe + addon consumptions without clobbering, snapshots non-recipe COGS, preserves weighted-avg unit_cost on PUT, and blocks DELETE /orders with 405", async () => {
    const tag = makeUniqueTag("COGS");
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    // 1. Weighted-average restock & PUT preservation
    const invBeanRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `Shared Syrup ${tag}`,
        category: "Syrups & Purees",
        quantity: 100,
        unit: "ml",
        purchasePrice: 100,
        packageQuantity: 1,
        contentsPerPackage: 100,
      },
    });
    assert.equal(invBeanRes.status, 201);
    const syrupId = Number(invBeanRes.data.id);
    tracker.inventoryItemIds.add(syrupId);
    assert.equal(invBeanRes.data.unitCost, 1);

    // Restock 100ml for 300 -> weighted avg = ((100*1) + 300) / 200 = 2.0
    const restockRes = await server.requestJson(`/api/inventory/${syrupId}/restock`, {
      method: "POST",
      token: admin.token,
      body: { quantity: 100, batchCost: 300, supplierName: "Tala Supplier", referenceNo: `REF-${tag}` },
    });
    assert.equal(restockRes.status, 200);
    assert.equal(restockRes.data.quantity, 200);
    assert.equal(restockRes.data.unitCost, 2);

    // PUT without altering purchasePrice/packageQuantity/contentsPerPackage MUST preserve weighted-avg unitCost=2
    const putPreserved = await server.requestJson(`/api/inventory/${syrupId}`, {
      method: "PUT",
      token: admin.token,
      body: {
        item: `Shared Syrup ${tag}`,
        category: "Syrups & Purees",
        quantity: 200,
        unit: "ml",
        maximumStock: 500,
        purchasePrice: 100,
        packageQuantity: 1,
        contentsPerPackage: 100,
      },
    });
    assert.equal(putPreserved.status, 200);
    assert.equal(putPreserved.data.unitCost, 2, "PUT /inventory/:id must preserve weighted-avg unit_cost when cost fields unchanged");

    // Create Cup item: 50 pcs @ ₱2.00 each
    const cupRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `Tala Cup ${tag}`,
        category: "Cups & Lids",
        quantity: 50,
        unit: "pcs",
        purchasePrice: 100,
        packageQuantity: 1,
        contentsPerPackage: 50,
      },
    });
    assert.equal(cupRes.status, 201);
    const cupId = Number(cupRes.data.id);
    tracker.inventoryItemIds.add(cupId);

    // 2. Create Drink (recipe uses Shared Syrup 30ml + Cup 1pc, AND addon "Extra Shared Syrup" uses Shared Syrup 15ml)
    const [drinkCat] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'drink')",
      [`COGS_Drink_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(drinkCat.insertId));

    const [snackCat] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
      [`COGS_Snack_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(snackCat.insertId));

    const drinkProdRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Shared Latte ${tag}`,
        category: `COGS_Drink_${tag}`,
        price: "120.00",
        stock: 0,
        sizes: [{
          label: "16oz",
          price: 120,
          ingredients: [
            { inventoryItemId: cupId, name: `Tala Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
            { inventoryItemId: syrupId, name: `Shared Syrup ${tag}`, quantityUsed: 30, unit: "ml", stockUnit: "ml" },
          ],
        }],
        ingredients: [
          { inventoryItemId: cupId, name: `Tala Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" },
          { inventoryItemId: syrupId, name: `Shared Syrup ${tag}`, quantityUsed: 30, unit: "ml", stockUnit: "ml" },
        ],
        addons: [
          {
            label: "Extra Shared Syrup",
            price: "25.00",
            inventoryItemId: syrupId,
            quantityUsed: 15,
            unit: "ml",
            stockUnit: "ml",
          },
        ],
      },
    });
    assert.equal(drinkProdRes.status, 201);
    const drinkId = Number(drinkProdRes.data.id);
    tracker.productIds.add(drinkId);

    // 3. Create Non-recipe Snack with costPrice: 32.50
    const snackProdRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Baked Pastry ${tag}`,
        category: `COGS_Snack_${tag}`,
        price: "85.00",
        costPrice: "32.50",
        stock: 20,
        sizes: [{ label: "Regular", price: 85 }],
        ingredients: [],
      },
    });
    assert.equal(snackProdRes.status, 201);
    const snackId = Number(snackProdRes.data.id);
    tracker.productIds.add(snackId);

    // 4. Place mixed order: 2x Shared Latte w/ Extra Shared Syrup, + 3x Baked Pastry
    // Drink unit cost = (1*2.0) + (30*2.0) + (15*2.0) = 2 + 60 + 30 = 92 per unit (184 total for qty 2)
    // Snack unit cost = 32.50 per unit
    const orderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "Dine-in",
        paymentMethod: "Cash",
        customerName: `Shared COGS ${tag}`,
        items: [
          { productId: drinkId, size: "16oz", quantity: 2, addons: ["Extra Shared Syrup"] },
          { productId: snackId, size: "Regular", quantity: 3 },
        ],
      },
    });
    assert.equal(orderRes.status, 201);
    const orderNo = orderRes.data.id;

    // Inspect order_inventory_consumptions directly
    const [consRows] = await pool.execute(
      `SELECT inventory_item_id, source, quantity_used, unit_cost_snapshot, line_cost
         FROM order_inventory_consumptions
        WHERE order_number = ?
        ORDER BY inventory_item_id ASC, source ASC`,
      [orderNo],
    );
    assert.equal(consRows.length, 3, "Must store 3 distinct consumption rows (cup recipe, syrup recipe, syrup addon)");

    const syrupRecipe = consRows.find((r) => Number(r.inventory_item_id) === syrupId && r.source === "recipe");
    const syrupAddon = consRows.find((r) => Number(r.inventory_item_id) === syrupId && r.source === "addon");
    const cupRecipe = consRows.find((r) => Number(r.inventory_item_id) === cupId && r.source === "recipe");
    assert.ok(syrupRecipe && syrupAddon && cupRecipe);

    assert.equal(Number(syrupRecipe.quantity_used), 60);
    assert.equal(Number(syrupRecipe.line_cost), 120);
    assert.equal(Number(syrupAddon.quantity_used), 30);
    assert.equal(Number(syrupAddon.line_cost), 60);
    assert.equal(Number(cupRecipe.quantity_used), 2);
    assert.equal(Number(cupRecipe.line_cost), 4);

    // Check order_items.unit_cost_snapshot for both lines
    const adminOrder = await server.requestJson(`/api/orders/${orderNo}`, { token: admin.token });
    assert.equal(adminOrder.status, 200);
    const drinkLine = adminOrder.data.items.find((i) => i.productId === drinkId);
    const snackLine = adminOrder.data.items.find((i) => i.productId === snackId);
    assert.equal(drinkLine.unitCost, 92);
    assert.equal(snackLine.unitCost, 32.5);

    // Check inventory quantities deducted properly: syrup 200 - 90 = 110; cup 50 - 2 = 48; snack stock 20 - 3 = 17
    const [[syrupAfter]] = await pool.execute("SELECT quantity FROM inventory_items WHERE id = ?", [syrupId]);
    const [[cupAfter]] = await pool.execute("SELECT quantity FROM inventory_items WHERE id = ?", [cupId]);
    const [[snackAfter]] = await pool.execute("SELECT stock_quantity FROM menu_products WHERE id = ?", [snackId]);
    assert.equal(Number(syrupAfter.quantity), 110);
    assert.equal(Number(cupAfter.quantity), 48);
    assert.equal(Number(snackAfter.stock_quantity), 17);

    // 5. DELETE /api/orders/:orderNumber -> 405
    const delAdmin = await server.requestJson(`/api/orders/${orderNo}`, { method: "DELETE", token: admin.token });
    assert.equal(delAdmin.status, 405);
    assert.match(delAdmin.data.message, /cannot be permanently deleted/i);

    const delStaff = await server.requestJson(`/api/orders/${orderNo}`, { method: "DELETE", token: staff.token });
    assert.equal(delStaff.status, 405);
  });

  it("handles non-destructive void (restoreStock true vs false), status timeline, and prevents over-restore on recipe products", async () => {
    const tag = makeUniqueTag("Void");
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    const cupRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: { item: `Void Cup ${tag}`, category: "Cups & Lids", quantity: 30, unit: "pcs", purchasePrice: 60, packageQuantity: 1, contentsPerPackage: 30 },
    });
    const cupId = Number(cupRes.data.id);
    tracker.inventoryItemIds.add(cupId);

    const [dCat] = await pool.execute("INSERT INTO menu_categories (name, operational_family) VALUES (?, 'drink')", [`Void_Drink_${tag}`]);
    tracker.menuCategoryIds.add(Number(dCat.insertId));
    const [sCat] = await pool.execute("INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')", [`Void_Snack_${tag}`]);
    tracker.menuCategoryIds.add(Number(sCat.insertId));

    const drinkRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Void Drink ${tag}`,
        category: `Void_Drink_${tag}`,
        price: "80.00",
        stock: 0,
        sizes: [{
          label: "Regular",
          price: 80,
          ingredients: [{ inventoryItemId: cupId, name: `Void Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
        }],
        ingredients: [{ inventoryItemId: cupId, name: `Void Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
      },
    });
    const drinkId = Number(drinkRes.data.id);
    tracker.productIds.add(drinkId);

    const snackRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Void Snack ${tag}`,
        category: `Void_Snack_${tag}`,
        price: "50.00",
        costPrice: "20.00",
        stock: 10,
        sizes: [{ label: "Regular", price: 50 }],
        ingredients: [],
      },
    });
    const snackId = Number(snackRes.data.id);
    tracker.productIds.add(snackId);

    // Order 1: restoreStock = true
    const o1Res = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        items: [
          { productId: drinkId, size: "Regular", quantity: 2 },
          { productId: snackId, size: "Regular", quantity: 3 },
        ],
      },
    });
    assert.equal(o1Res.status, 201);
    const o1No = o1Res.data.id;

    // Advance status Pending -> Preparing before voiding
    const prepRes = await server.requestJson(`/api/orders/${o1No}/status`, {
      method: "PATCH",
      token: staff.token,
      body: { status: "Preparing" },
    });
    assert.equal(prepRes.status, 200);

    // Validation: reason < 3 chars -> 400
    const badReason = await server.requestJson(`/api/orders/${o1No}/void`, {
      method: "POST",
      token: admin.token,
      body: { reason: "no", restoreStock: true },
    });
    assert.equal(badReason.status, 400);

    // Void Order 1 with restoreStock: true
    const void1 = await server.requestJson(`/api/orders/${o1No}/void`, {
      method: "POST",
      token: admin.token,
      body: { reason: "Customer changed mind before prep", restoreStock: true },
    });
    assert.equal(void1.status, 200);
    assert.equal(void1.data.status, "Cancelled");
    assert.equal(void1.data.voidReason, "Customer changed mind before prep");
    assert.equal(void1.data.voidedBy, admin.id);
    assert.ok(void1.data.voidedAt);

    // Timeline events: null->Pending, Pending->Preparing, Preparing->Cancelled
    assert.equal(void1.data.statusEvents.length, 3);
    assert.deepEqual(
      void1.data.statusEvents.map((e) => [e.fromStatus, e.toStatus]),
      [[null, "Pending"], ["Pending", "Preparing"], ["Preparing", "Cancelled"]],
    );
    assert.ok(void1.data.consumptions.every((c) => c.reversedAt !== null));

    // Stock restored for cup (30 - 2 + 2 = 30) and non-recipe snack (10 - 3 + 3 = 10),
    // while recipe drink's menu_products.stock_quantity stays at 0 (no clamped over-restore!)
    const [[cupPostVoid1]] = await pool.execute("SELECT quantity FROM inventory_items WHERE id = ?", [cupId]);
    const [[snackPostVoid1]] = await pool.execute("SELECT stock_quantity FROM menu_products WHERE id = ?", [snackId]);
    const [[drinkPostVoid1]] = await pool.execute("SELECT stock_quantity FROM menu_products WHERE id = ?", [drinkId]);
    assert.equal(Number(cupPostVoid1.quantity), 30);
    assert.equal(Number(snackPostVoid1.stock_quantity), 10);
    assert.equal(Number(drinkPostVoid1.stock_quantity), 0, "Recipe product stock_quantity must NOT be inflated on void");

    const [voidRestoreRows] = await pool.execute(
      `SELECT m.movement_type, m.quantity_change, m.before_quantity, m.after_quantity
         FROM inventory_movements m
         JOIN orders o ON o.id = m.order_id
        WHERE o.order_number = ? AND m.movement_type = 'void_restore'`,
      [o1No],
    );
    assert.equal(voidRestoreRows.length, 1, "restoreStock=true must emit void_restore movement row");
    assert.equal(Number(voidRestoreRows[0].quantity_change), 2);
    assert.equal(Number(voidRestoreRows[0].before_quantity), 28);
    assert.equal(Number(voidRestoreRows[0].after_quantity), 30);

    // Duplicate void -> 409, status advance -> 409
    const dupVoid = await server.requestJson(`/api/orders/${o1No}/void`, {
      method: "POST",
      token: admin.token,
      body: { reason: "Duplicate void" },
    });
    assert.equal(dupVoid.status, 409);

    const advanceVoided = await server.requestJson(`/api/orders/${o1No}/status`, {
      method: "PATCH",
      token: admin.token,
      body: { status: "Completed" },
    });
    assert.equal(advanceVoided.status, 409);

    // Order 2: restoreStock = false -> logs 'spoilage', does NOT restore stock
    const o2Res = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        items: [
          { productId: drinkId, size: "Regular", quantity: 4 },
          { productId: snackId, size: "Regular", quantity: 2 },
        ],
      },
    });
    assert.equal(o2Res.status, 201);
    const o2No = o2Res.data.id;

    const void2 = await server.requestJson(`/api/orders/${o2No}/void`, {
      method: "POST",
      token: admin.token,
      body: { reason: "Drink spilled on counter", restoreStock: false },
    });
    assert.equal(void2.status, 200);
    assert.equal(void2.data.status, "Cancelled");
    assert.ok(void2.data.consumptions.every((c) => c.reversedAt === null), "Spoilage void keeps consumptions unreversed");

    const [[cupPostVoid2]] = await pool.execute("SELECT quantity FROM inventory_items WHERE id = ?", [cupId]);
    const [[snackPostVoid2]] = await pool.execute("SELECT stock_quantity FROM menu_products WHERE id = ?", [snackId]);
    assert.equal(Number(cupPostVoid2.quantity), 26, "Spoilage void must NOT restore inventory stock");
    assert.equal(Number(snackPostVoid2.stock_quantity), 8, "Spoilage void must NOT restore non-recipe stock");

    const [spoilageRows] = await pool.execute(
      `SELECT m.movement_type, m.quantity_change, m.before_quantity, m.after_quantity
         FROM inventory_movements m
         JOIN orders o ON o.id = m.order_id
        WHERE o.order_number = ? AND m.movement_type = 'spoilage'`,
      [o2No],
    );
    assert.equal(spoilageRows.length, 1);
    assert.equal(Number(spoilageRows[0].quantity_change), 0);
    assert.equal(Number(spoilageRows[0].before_quantity), 26);
    assert.equal(Number(spoilageRows[0].after_quantity), 26);
  });

  it("manages cashier_sessions open/close reconciliation, auto-linked orders/movements, duplicate 409, and variance math", async () => {
    const tag = makeUniqueTag("Session");
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    // Setup inventory + menu product
    const invRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: { item: `Session Cup ${tag}`, category: "Cups & Lids", quantity: 40, unit: "pcs", purchasePrice: 80, packageQuantity: 1, contentsPerPackage: 40 },
    });
    const cupId = Number(invRes.data.id);
    tracker.inventoryItemIds.add(cupId);

    const [cat] = await pool.execute("INSERT INTO menu_categories (name, operational_family) VALUES (?, 'drink')", [`Sess_Drink_${tag}`]);
    tracker.menuCategoryIds.add(Number(cat.insertId));

    const prodRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Session Iced Coffee ${tag}`,
        category: `Sess_Drink_${tag}`,
        price: "100.00",
        sizes: [{
          label: "Regular",
          price: 100,
          ingredients: [{ inventoryItemId: cupId, name: `Session Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
        }],
        ingredients: [{ inventoryItemId: cupId, name: `Session Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
      },
    });
    const prodId = Number(prodRes.data.id);
    tracker.productIds.add(prodId);

    // 1. Open session for staff with openingFloat = 1500
    const openRes = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staff.token,
      body: { openingFloat: 1500, terminalLabel: "Counter Tala" },
    });
    assert.equal(openRes.status, 201);
    const sessionId = Number(openRes.data.session.id);
    tracker.sessionIds.add(sessionId);
    assert.equal(openRes.data.session.status, "open");
    assert.equal(openRes.data.session.openingFloat, 1500);
    assert.equal(openRes.data.session.expectedCash, 1500);

    // Duplicate open session rejected 409
    const dupOpen = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: staff.token,
      body: { openingFloat: 500 },
    });
    assert.equal(dupOpen.status, 409);

    const currRes = await server.requestJson("/api/sessions/current", { token: staff.token });
    assert.equal(currRes.status, 200);
    assert.equal(currRes.data.session.id, sessionId);

    // 2. Place Cash order (200), GCash order (100), and voided Cash order (100)
    const cashOrder = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: { type: "Counter", paymentMethod: "Cash", items: [{ productId: prodId, size: "Regular", quantity: 2 }] },
    });
    assert.equal(cashOrder.status, 201);
    assert.equal(cashOrder.data.sessionId, sessionId);

    const gcashOrder = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: { type: "Takeout", paymentMethod: "GCash", items: [{ productId: prodId, size: "Regular", quantity: 1 }] },
    });
    assert.equal(gcashOrder.status, 201);
    assert.equal(gcashOrder.data.sessionId, sessionId);

    const voidedCashOrder = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: { type: "Counter", paymentMethod: "Cash", items: [{ productId: prodId, size: "Regular", quantity: 1 }] },
    });
    assert.equal(voidedCashOrder.status, 201);
    await server.requestJson(`/api/orders/${voidedCashOrder.data.id}/void`, {
      method: "POST",
      token: admin.token,
      body: { reason: "Void during shift test", restoreStock: true },
    });

    // Check auto-linked usage movements
    const [sessMovements] = await pool.execute(
      "SELECT id, movement_type, session_id FROM inventory_movements WHERE session_id = ?",
      [sessionId],
    );
    assert.ok(sessMovements.length >= 3, "Orders placed during session must link usage movements to session_id");

    // Admin also opens a session & restocks -> restock movement auto-linked to Admin session_id
    const adminOpen = await server.requestJson("/api/sessions/open", {
      method: "POST",
      token: admin.token,
      body: { openingFloat: 0, terminalLabel: "Admin Desk" },
    });
    assert.equal(adminOpen.status, 201);
    const adminSessionId = Number(adminOpen.data.session.id);
    tracker.sessionIds.add(adminSessionId);

    await server.requestJson(`/api/inventory/${cupId}/restock`, {
      method: "POST",
      token: admin.token,
      body: { quantity: 5, batchCost: 10 },
    });
    const [[linkedRestock]] = await pool.execute(
      "SELECT session_id FROM inventory_movements WHERE inventory_item_id = ? AND movement_type = 'restock' ORDER BY id DESC LIMIT 1",
      [cupId],
    );
    assert.equal(Number(linkedRestock.session_id), adminSessionId);

    // 3. Close staff shift: missing countedCash -> 400; valid countedCash=1685 -> expectedCash=1700, variance=-15
    const missingCounted = await server.requestJson(`/api/sessions/${sessionId}/close`, {
      method: "POST",
      token: staff.token,
      body: {},
    });
    assert.equal(missingCounted.status, 400);

    const closeRes = await server.requestJson(`/api/sessions/${sessionId}/close`, {
      method: "POST",
      token: staff.token,
      body: { countedCash: 1685, closingNotes: "Short 15 pesos test variance" },
    });
    assert.equal(closeRes.status, 200);
    const closed = closeRes.data.session;
    assert.equal(closed.status, "closed");
    assert.equal(closed.openingFloat, 1500);
    assert.equal(closed.cashSales, 200);
    assert.equal(closed.gcashSales, 100);
    assert.equal(closed.paidSales, 300);
    assert.equal(closed.expectedCash, 1700);
    assert.equal(closed.countedCash, 1685);
    assert.equal(closed.variance, -15);
    assert.equal(closed.voidedOrdersCount, 1);
    assert.equal(closed.paidOrdersCount, 2);
    assert.equal(closed.ordersCount, 3);
    assert.equal(closed.closedBy, Number(staff.id));

    // Re-closing already-closed session -> 409
    const reclose = await server.requestJson(`/api/sessions/${sessionId}/close`, {
      method: "POST",
      token: admin.token,
      body: { countedCash: 1700 },
    });
    assert.equal(reclose.status, 409);

    // Session detail check (RBAC: staff cannot inspect admin session; admin can inspect staff session with costing)
    const crossSessionForbidden = await server.requestJson(`/api/sessions/${adminSessionId}`, { token: staff.token });
    assert.equal(crossSessionForbidden.status, 403);

    const detailAdmin = await server.requestJson(`/api/sessions/${sessionId}`, { token: admin.token });
    assert.equal(detailAdmin.status, 200);
    assert.equal(detailAdmin.data.orders.length, 3);
    assert.equal(detailAdmin.data.paymentBreakdown.length, 2);
    assert.equal(detailAdmin.data.productBreakdown[0].unitsSold, 3);
    assert.equal(detailAdmin.data.productBreakdown[0].sales, 300);
    assert.equal(detailAdmin.data.productBreakdown[0].cogs, 6);
    assert.equal(detailAdmin.data.productBreakdown[0].grossProfit, 294);
  });

  it("reverts per-product items (Pending, Preparing admin auth, last-item cancel, partial revert + full void ledger parity)", async () => {
    const tag = makeUniqueTag("ItemRevert");
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    const cupRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: { item: `Revert Cup ${tag}`, category: "Cups & Lids", quantity: 40, unit: "pcs", purchasePrice: 80, packageQuantity: 1, contentsPerPackage: 40 },
    });
    assert.equal(cupRes.status, 201);
    const cupId = Number(cupRes.data.id);
    tracker.inventoryItemIds.add(cupId);

    const [dCat] = await pool.execute("INSERT INTO menu_categories (name, operational_family) VALUES (?, 'drink')", [`Revert_Drink_${tag}`]);
    tracker.menuCategoryIds.add(Number(dCat.insertId));
    const [sCat] = await pool.execute("INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')", [`Revert_Snack_${tag}`]);
    tracker.menuCategoryIds.add(Number(sCat.insertId));

    const drinkRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Revert Drink ${tag}`,
        category: `Revert_Drink_${tag}`,
        price: "100.00",
        stock: 0,
        sizes: [{
          label: "Regular",
          price: 100,
          ingredients: [{ inventoryItemId: cupId, name: `Revert Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
        }],
        ingredients: [{ inventoryItemId: cupId, name: `Revert Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
      },
    });
    assert.equal(drinkRes.status, 201);
    const drinkId = Number(drinkRes.data.id);
    tracker.productIds.add(drinkId);

    const snackRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Revert Snack ${tag}`,
        category: `Revert_Snack_${tag}`,
        price: "50.00",
        costPrice: "15.00",
        stock: 10,
        sizes: [{ label: "Regular", price: 50 }],
        ingredients: [],
      },
    });
    assert.equal(snackRes.status, 201);
    const snackId = Number(snackRes.data.id);
    tracker.productIds.add(snackId);

    // Order A: 2x Drink (200, COGS 4) + 1x Snack (50, COGS 15) => total 250
    const orderARes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        cashTendered: 300,
        items: [
          { productId: drinkId, size: "Regular", quantity: 2 },
          { productId: snackId, size: "Regular", quantity: 1 },
        ],
      },
    });
    assert.equal(orderARes.status, 201);
    const orderANo = orderARes.data.id;
    const drinkItemA = orderARes.data.items.find((i) => Number(i.productId) === drinkId);
    const snackItemA = orderARes.data.items.find((i) => Number(i.productId) === snackId);
    assert.ok(drinkItemA?.id);
    assert.ok(snackItemA?.id);

    // 1. Staff reverts 1x Drink while Pending WITHOUT adminPassword -> 200
    const partialRes = await server.requestJson(`/api/orders/${orderANo}/items/${drinkItemA.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: { quantity: 1, reason: "Wrong quantity punched", restoreStock: true },
    });
    assert.equal(partialRes.status, 200);
    assert.equal(partialRes.data.status, "Pending");
    assert.equal(Number(partialRes.data.total), 150);
    assert.equal(partialRes.data.items.find((i) => Number(i.id) === Number(drinkItemA.id)).quantity, 1);

    const [[cupAfterPartial]] = await pool.execute("SELECT quantity FROM inventory_items WHERE id = ?", [cupId]);
    assert.equal(Number(cupAfterPartial.quantity), 39, "1 of 2 cups restored after partial qty revert");

    // 2. Advance Order A to Preparing -> Staff revert without valid admin password gets 403
    const prepRes = await server.requestJson(`/api/orders/${orderANo}/status`, {
      method: "PATCH",
      token: staff.token,
      body: { status: "Preparing" },
    });
    assert.equal(prepRes.status, 200);

    const noPassRes = await server.requestJson(`/api/orders/${orderANo}/items/${snackItemA.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: { reason: "Customer ordered something else", restoreStock: true },
    });
    assert.equal(noPassRes.status, 403);

    const wrongPassRes = await server.requestJson(`/api/orders/${orderANo}/items/${snackItemA.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: { reason: "Customer ordered something else", restoreStock: true, adminPassword: "wrong-password" },
    });
    assert.equal(wrongPassRes.status, 403);

    // With valid adminPassword -> 200 (backward compatibility + authorizedBy + admin audit notification)
    const withPassRes = await server.requestJson(`/api/orders/${orderANo}/items/${snackItemA.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: { reason: "Customer ordered something else", restoreStock: true, adminPassword: admin.password },
    });
    assert.equal(withPassRes.status, 200);
    assert.equal(Number(withPassRes.data.total), 100);
    assert.equal(withPassRes.data.items.length, 1);
    assert.deepEqual(withPassRes.data.authorizedBy, {
      id: admin.id,
      displayName: admin.displayName,
      role: "admin",
    });
    assert.ok(
      withPassRes.data.statusEvents.some((e) =>
        String(e.reason || "").includes(`(Authorized by ${admin.displayName} [admin])`),
      ),
      "order_status_events must record admin authorizer name and role",
    );

    const [[snackAfterRevert]] = await pool.execute("SELECT stock_quantity FROM menu_products WHERE id = ?", [snackId]);
    assert.equal(Number(snackAfterRevert.stock_quantity), 10, "Non-recipe snack stock restored cleanly");

    // 3. Full /void on Order A after partial item reverts -> must NOT double-reverse already-reverted ledger amounts
    const voidARes = await server.requestJson(`/api/orders/${orderANo}/void`, {
      method: "POST",
      token: admin.token,
      body: { reason: "Full void after partial item reverts", restoreStock: true },
    });
    assert.equal(voidARes.status, 200);
    assert.equal(voidARes.data.status, "Cancelled");

    const [[orderARow]] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [orderANo]);
    const [orderANetAccounts] = await pool.execute(
      `SELECT coa.account_code,
              ROUND(SUM(jel.debit), 2) AS total_debit,
              ROUND(SUM(jel.credit), 2) AS total_credit,
              ROUND(SUM(jel.debit) - SUM(jel.credit), 2) AS net_dc
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.order_id = ?
        GROUP BY coa.account_code`,
      [orderARow.id],
    );
    for (const acct of orderANetAccounts) {
      assert.equal(Number(acct.net_dc), 0, `Account ${acct.account_code} on partially-reverted then voided order must net to 0`);
    }

    const [[trialBalance]] = await pool.execute(
      "SELECT ROUND(SUM(debit), 2) AS debits, ROUND(SUM(credit), 2) AS credits FROM journal_entry_lines",
    );
    assert.equal(Number(trialBalance.debits), Number(trialBalance.credits), "Global trial balance must stay balanced");

    // 4. Order B: single item -> reverting the last item cancels the full order non-destructively
    const orderBRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        items: [{ productId: drinkId, size: "Regular", quantity: 1 }],
      },
    });
    assert.equal(orderBRes.status, 201);
    const orderBNo = orderBRes.data.id;
    const drinkItemB = orderBRes.data.items[0];

    const lastItemRevert = await server.requestJson(`/api/orders/${orderBNo}/items/${drinkItemB.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: { reason: "Wrong product ordered", restoreStock: true },
    });
    assert.equal(lastItemRevert.status, 200);
    assert.equal(lastItemRevert.data.status, "Cancelled");
    assert.match(lastItemRevert.data.voidReason || "", /Reverted/i);

    const [[cupFinal]] = await pool.execute("SELECT quantity FROM inventory_items WHERE id = ?", [cupId]);
    assert.equal(Number(cupFinal.quantity), 40, "All cups restored across Order A and Order B");

    // 5. Order C (Completed): Staff-password revert authorization, Admin-only audit notifications, & void RBAC
    const staffApprover = await tracker.createUser({
      role: "staff",
      displayName: `Tala Approver ${tag}`,
    });

    const orderCRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "Counter",
        paymentMethod: "Cash",
        cashTendered: 200,
        items: [
          { productId: drinkId, size: "Regular", quantity: 1 },
          { productId: snackId, size: "Regular", quantity: 1 },
        ],
      },
    });
    assert.equal(orderCRes.status, 201);
    const orderCNo = orderCRes.data.id;
    const drinkItemC = orderCRes.data.items.find((i) => Number(i.productId) === drinkId);
    const snackItemC = orderCRes.data.items.find((i) => Number(i.productId) === snackId);
    assert.ok(drinkItemC?.id && snackItemC?.id);

    // Advance Order C Pending -> Preparing -> Completed
    assert.equal(
      (await server.requestJson(`/api/orders/${orderCNo}/status`, {
        method: "PATCH",
        token: staff.token,
        body: { status: "Preparing" },
      })).status,
      200,
    );
    assert.equal(
      (await server.requestJson(`/api/orders/${orderCNo}/status`, {
        method: "PATCH",
        token: staff.token,
        body: { status: "Completed" },
      })).status,
      200,
    );

    // Full-order /void must STILL return 403 for staff
    const staffVoidDenied = await server.requestJson(`/api/orders/${orderCNo}/void`, {
      method: "POST",
      token: staff.token,
      body: { reason: "Staff void attempt", restoreStock: true },
    });
    assert.equal(staffVoidDenied.status, 403, "POST /api/orders/:orderNumber/void must remain strictly 403 for staff");

    // Completed item revert with missing / wrong password -> 403
    const completedNoPass = await server.requestJson(`/api/orders/${orderCNo}/items/${drinkItemC.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: { reason: "Spilled at pickup", restoreStock: true },
    });
    assert.equal(completedNoPass.status, 403);

    const completedWrongPass = await server.requestJson(`/api/orders/${orderCNo}/items/${drinkItemC.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: { reason: "Spilled at pickup", restoreStock: true, authorizationPassword: "not-a-valid-password" },
    });
    assert.equal(completedWrongPass.status, 403);

    // Valid active staff password on Completed order -> 200 (inventory restored, authorizedBy.role === 'staff')
    const staffAuthRevert = await server.requestJson(`/api/orders/${orderCNo}/items/${drinkItemC.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: {
        reason: "Customer switched drink after completion",
        restoreStock: true,
        authorizationPassword: staffApprover.password,
      },
    });
    assert.equal(staffAuthRevert.status, 200);
    assert.equal(Number(staffAuthRevert.data.total), 50);
    assert.equal(staffAuthRevert.data.items.length, 1);
    assert.deepEqual(staffAuthRevert.data.authorizedBy, {
      id: staffApprover.id,
      displayName: staffApprover.displayName,
      role: "staff",
    });

    const [[cupAfterStaffRevert]] = await pool.execute("SELECT quantity FROM inventory_items WHERE id = ?", [cupId]);
    assert.equal(Number(cupAfterStaffRevert.quantity), 40, "Staff-authorized revert must restore cup inventory");

    const [[orderCRow]] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [orderCNo]);
    const [orderCEvents] = await pool.execute(
      "SELECT reason, actor_name_snapshot FROM order_status_events WHERE order_id = ? ORDER BY id DESC LIMIT 1",
      [orderCRow.id],
    );
    assert.equal(orderCEvents.length, 1);
    assert.ok(
      String(orderCEvents[0].reason || "").includes(`(Authorized by ${staffApprover.displayName} [staff])`),
      "order_status_events must record staff authorizer name and role",
    );

    // Admin notification saved for active admin, NOT delivered to staff
    const adminNotifs = await server.requestJson("/api/notifications", { token: admin.token });
    assert.equal(adminNotifs.status, 200);
    const revertNotif = adminNotifs.data.find(
      (n) => n.type === "order_revert" && String(n.title || "").includes(orderCNo),
    );
    assert.ok(revertNotif, "Admin must receive persistent order_revert notification");
    assert.ok(
      String(revertNotif.message || "").includes(`Authorized by ${staffApprover.displayName} (staff)`),
      "Admin notification must include authorizing staff displayName and role",
    );

    for (const sUser of [staff, staffApprover]) {
      const staffNotifs = await server.requestJson("/api/notifications", { token: sUser.token });
      assert.equal(staffNotifs.status, 200);
      assert.equal(
        staffNotifs.data.some((n) => n.type === "order_revert"),
        false,
        "order_revert notifications must NOT be delivered to staff accounts",
      );
    }

    // Last remaining item on Completed Order C reverted with staff password -> cancels full order + preserves voidedBy & ledger parity
    const finalItemStaffRevert = await server.requestJson(`/api/orders/${orderCNo}/items/${snackItemC.id}/revert`, {
      method: "POST",
      token: staff.token,
      body: {
        reason: "Customer cancelled remaining snack",
        restoreStock: true,
        authorizationPassword: staffApprover.password,
      },
    });
    assert.equal(finalItemStaffRevert.status, 200);
    assert.equal(finalItemStaffRevert.data.status, "Cancelled");
    assert.equal(finalItemStaffRevert.data.voidedBy, staffApprover.id);
    assert.ok(
      String(finalItemStaffRevert.data.voidReason || "").includes(`(Authorized by ${staffApprover.displayName} [staff])`),
      "Full cancel by last-item revert must preserve staff authorizer in void_reason",
    );

    const [[snackAfterStaffRevert]] = await pool.execute("SELECT stock_quantity FROM menu_products WHERE id = ?", [snackId]);
    assert.equal(Number(snackAfterStaffRevert.stock_quantity), 10, "Snack stock restored after staff-authorized full cancel revert");

    const [orderCNetAccounts] = await pool.execute(
      `SELECT coa.account_code,
              ROUND(SUM(jel.debit) - SUM(jel.credit), 2) AS net_dc
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE je.order_id = ?
        GROUP BY coa.account_code`,
      [orderCRow.id],
    );
    for (const acct of orderCNetAccounts) {
      assert.equal(Number(acct.net_dc), 0, `Account ${acct.account_code} on staff-reverted Order C must net to 0`);
    }

    const [[trialBalancePostStaffRevert]] = await pool.execute(
      "SELECT ROUND(SUM(debit), 2) AS debits, ROUND(SUM(credit), 2) AS credits FROM journal_entry_lines",
    );
    assert.equal(
      Number(trialBalancePostStaffRevert.debits),
      Number(trialBalancePostStaffRevert.credits),
      "Global trial balance must remain balanced after staff-authorized reverts",
    );
  });
});
