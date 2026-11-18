import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import mysql from "../api/node_modules/mysql2/promise.js";
import pool from "../api/src/database.js";
import {
  CLIENT_REQUEST_ID_REGEX,
  escapeLikePattern,
  parseOptionalClientRequestId,
  validateImageUrl,
} from "../api/src/utils/validation.js";
import { buildInventoryTriagePayload } from "../api/src/routes/decisions.js";
import { createClientRequestId } from "../src/utils/clientRequestId.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

const execFileAsync = promisify(execFile);

describe("Phase 2 Hardening Suite (P2-16 .. P2-19)", () => {
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

  it("validates clientRequestId, image uploads (rejects SVG & >5MB), and escapes SQL LIKE wildcards", () => {
    assert.equal(parseOptionalClientRequestId(undefined), null);
    assert.equal(parseOptionalClientRequestId(null), null);
    assert.equal(parseOptionalClientRequestId(""), null);
    const validKey = "ord-1731940000000-abcdef1234";
    assert.equal(parseOptionalClientRequestId(validKey), validKey);

    assert.throws(
      () => parseOptionalClientRequestId(123456),
      (err) => err.status === 400,
    );
    assert.throws(
      () => parseOptionalClientRequestId("short"),
      (err) => err.status === 400,
    );
    assert.throws(
      () => parseOptionalClientRequestId("x".repeat(97)),
      (err) => err.status === 400,
    );
    assert.throws(
      () => parseOptionalClientRequestId("bad spaces !@#$%^&*()"),
      (err) => err.status === 400,
    );

    assert.throws(
      () => validateImageUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
      (err) => err.status === 400 && /SVG/i.test(err.message),
    );
    const oversizedBase64 = "A".repeat(7_000_000);
    assert.throws(
      () => validateImageUrl(`data:image/png;base64,${oversizedBase64}`),
      (err) => err.status === 413,
    );
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    assert.equal(validateImageUrl(tinyPng), tinyPng);
    assert.equal(validateImageUrl("https://cdn.example.com/latte.webp"), "https://cdn.example.com/latte.webp");

    assert.equal(escapeLikePattern("50%_\\latte"), "50\\%\\_\\\\latte");
    assert.equal(escapeLikePattern(null), "");
  });

  it("supports POST /api/auth/logout JWT token_version revocation and targeted cashier lookup while keeping shared staff login", async () => {
    const tag = makeUniqueTag("AuthLogout");
    const staffA = await tracker.createUser({
      role: "staff",
      username: "staff",
      displayName: `Cashier Target A ${tag}`,
      password: `PassA_${tag}`,
    });
    const staffB = await tracker.createUser({
      role: "staff",
      username: "staff",
      displayName: `Cashier Target B ${tag}`,
      password: `PassB_${tag}`,
    });

    // Targeted login with cashierId, displayName, and identifier
    const loginById = await server.requestJson("/api/auth/login", {
      method: "POST",
      body: { username: "staff", password: staffA.password, cashierId: staffA.id },
    });
    assert.equal(loginById.status, 200, `Targeted login by cashierId failed: ${loginById.text}`);
    assert.equal(Number(loginById.data.user.id), staffA.id);

    const loginByDisplay = await server.requestJson("/api/auth/login", {
      method: "POST",
      body: { username: "staff", password: staffB.password, displayName: staffB.displayName },
    });
    assert.equal(loginByDisplay.status, 200);
    assert.equal(Number(loginByDisplay.data.user.id), staffB.id);

    // Mismatched target + password must reject
    const mismatchLogin = await server.requestJson("/api/auth/login", {
      method: "POST",
      body: { username: "staff", password: staffB.password, cashierId: staffA.id },
    });
    assert.equal(mismatchLogin.status, 401);

    // Backward-compatible shared "staff" login (no identifier) still works
    const sharedLogin = await server.requestJson("/api/auth/login", {
      method: "POST",
      body: { username: "staff", password: staffA.password },
    });
    assert.equal(sharedLogin.status, 200);
    const activeToken = sharedLogin.data.token;

    // Targeted switch-cashier succeeds and wrong cashierId rejects with 403
    const switchTarget = await server.requestJson("/api/auth/switch-cashier", {
      method: "POST",
      token: activeToken,
      body: { password: staffB.password, identifier: staffB.displayName },
    });
    assert.equal(switchTarget.status, 200);
    assert.equal(Number(switchTarget.data.user.id), staffB.id);

    const switchMismatch = await server.requestJson("/api/auth/switch-cashier", {
      method: "POST",
      token: activeToken,
      body: { password: staffB.password, cashierId: staffA.id },
    });
    assert.equal(switchMismatch.status, 403);

    // Explicit logout revokes JWT immediately via token_version increment
    const meBefore = await server.requestJson("/api/auth/me", { token: activeToken });
    assert.equal(meBefore.status, 200);

    const logoutRes = await server.requestJson("/api/auth/logout", {
      method: "POST",
      token: activeToken,
    });
    assert.equal(logoutRes.status, 200);

    const meAfter = await server.requestJson("/api/auth/me", { token: activeToken });
    assert.equal(meAfter.status, 401, "Revoked JWT must return 401 after POST /api/auth/logout");
  });

  it("enforces order idempotency, invalid orderType/paymentMethod 400, and single-open-shift DB uniqueness (409)", async () => {
    const tag = makeUniqueTag("OrderIdemp");
    const admin = await tracker.createUser({ role: "admin", password: `Adm_${tag}` });
    const staff = await tracker.createUser({
      role: "staff",
      username: "staff",
      displayName: `Idemp Cashier ${tag}`,
      password: `Stf_${tag}`,
    });

    // Concurrent open-shift calls for the same cashier: uq_cashier_sessions_open_user permits strictly 1 (201) and rejects duplicate (409)
    const [openRes1, openRes2] = await Promise.all([
      server.requestJson("/api/sessions/open", {
        method: "POST",
        token: staff.token,
        body: { openingFloat: 500 },
      }),
      server.requestJson("/api/sessions/open", {
        method: "POST",
        token: staff.token,
        body: { openingFloat: 500 },
      }),
    ]);
    const openStatuses = [openRes1.status, openRes2.status].sort((a, b) => a - b);
    assert.deepEqual(openStatuses, [201, 409], `Expected [201, 409], got ${JSON.stringify(openStatuses)}`);
    const openedSession = openRes1.status === 201 ? openRes1.data.session : openRes2.data.session;
    tracker.sessionIds.add(Number(openedSession.id));

    // Create costed ingredient + menu product
    const invRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `Hardening Beans ${tag}`,
        category: "Coffee & Espresso",
        quantity: 100,
        unit: "g",
        purchasePrice: 500,
        packageQuantity: 1,
        contentsPerPackage: 100,
      },
    });
    assert.equal(invRes.status, 201);
    const ingId = Number(invRes.data.id);
    tracker.inventoryItemIds.add(ingId);

    const [catRow] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'food')",
      [`Hardening_Cat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(catRow.insertId));

    const prodRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Hardening Espresso ${tag}`,
        category: `Hardening_Cat_${tag}`,
        price: "95.00",
        stock: 0,
        sizes: [
          {
            label: "Regular",
            price: 95,
            ingredients: [{ inventoryItemId: ingId, name: `Hardening Beans ${tag}`, quantityUsed: 10, unit: "g", stockUnit: "g" }],
          },
        ],
        ingredients: [{ inventoryItemId: ingId, name: `Hardening Beans ${tag}`, quantityUsed: 10, unit: "g", stockUnit: "g" }],
      },
    });
    assert.equal(prodRes.status, 201, `Menu create failed: ${prodRes.text}`);
    const productId = Number(prodRes.data.id);
    tracker.productIds.add(productId);

    // Invalid order type & payment method -> 400
    const badTypeRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "DroneDelivery",
        paymentMethod: "Cash",
        items: [{ productId, quantity: 1 }],
      },
    });
    assert.equal(badTypeRes.status, 400);

    const badPayRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: {
        type: "Counter",
        paymentMethod: "Crypto",
        items: [{ productId, quantity: 1 }],
      },
    });
    assert.equal(badPayRes.status, 400);

    // clientRequestId idempotency
    const reqKey = createClientRequestId("ord");
    const orderPayload = {
      type: "Counter",
      paymentMethod: "Cash",
      cashTendered: 100,
      customerName: `Idemp Buyer ${tag}`,
      clientRequestId: reqKey,
      items: [{ productId, quantity: 1 }],
    };
    const firstOrder = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: orderPayload,
    });
    assert.equal(firstOrder.status, 201, `Expected 201 on first order, got ${firstOrder.text}`);

    const replayOrder = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: orderPayload,
    });
    assert.equal(replayOrder.status, 200, "Idempotent replay must return 200 with existing order");
    assert.equal(replayOrder.data.id, firstOrder.data.id);

    const mismatchReplay = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: { ...orderPayload, type: "Takeout" },
    });
    assert.equal(mismatchReplay.status, 409);
  });

  it("enforces 401-before-405 across orders.js, finances.js, and decisions.js and omits unitCost from AI payloads", async () => {
    const tag = makeUniqueTag("Auth405");
    const admin = await tracker.createUser({ role: "admin", password: `Adm_${tag}` });
    const staff = await tracker.createUser({
      role: "staff",
      username: "staff",
      displayName: `Auth405 Staff ${tag}`,
      password: `Stf_${tag}`,
    });

    // orders.js: 401 unauthenticated vs 405 authenticated
    const unauthOrderDel = await server.requestJson("/api/orders/AM-999999", { method: "DELETE" });
    assert.equal(unauthOrderDel.status, 401);
    const authOrderDel = await server.requestJson("/api/orders/AM-999999", {
      method: "DELETE",
      token: staff.token,
    });
    assert.equal(authOrderDel.status, 405);

    // finances.js: 401 unauthenticated, 403 staff, 405 admin
    for (const ep of ["/api/finances/accounts", "/api/finances/accounts/1", "/api/finances/journal-entries/1"]) {
      const unauthPut = await server.requestJson(ep, { method: "PUT", body: {} });
      assert.equal(unauthPut.status, 401, `Expected 401 on unauthenticated PUT ${ep}, got ${unauthPut.status}`);

      const staffPut = await server.requestJson(ep, { method: "PUT", token: staff.token, body: {} });
      assert.equal(staffPut.status, 403, `Expected 403 on staff PUT ${ep}, got ${staffPut.status}`);

      const adminPut = await server.requestJson(ep, { method: "PUT", token: admin.token, body: {} });
      assert.equal(adminPut.status, 405, `Expected 405 on admin PUT ${ep}, got ${adminPut.status}`);
    }

    // decisions.js: 401 unauthenticated, 403 staff on admin route, 405 wrong method after auth
    const unauthDecision = await server.requestJson("/api/decisions/inventory-triage", { method: "GET" });
    assert.equal(unauthDecision.status, 401);

    const staffDecision = await server.requestJson("/api/decisions/inventory-triage", {
      method: "GET",
      token: staff.token,
    });
    assert.equal(staffDecision.status, 403);

    const adminWrongMethod = await server.requestJson("/api/decisions/inventory-triage", {
      method: "GET",
      token: admin.token,
    });
    assert.equal(adminWrongMethod.status, 405);

    // buildInventoryTriagePayload & live POST /api/decisions/inventory-triage omit unitCost
    const sampleState = buildInventoryTriagePayload([
      { id: 1, name: "Whole Milk", category: "Dairy", quantity: 5, unit: "L", maximum_stock: 20, unit_cost: 92.5 },
    ]);
    assert.equal(Object.hasOwn(sampleState[0], "unitCost"), false);
    assert.equal(Object.hasOwn(sampleState[0], "unit_cost"), false);

    // Ensure at least one active inventory item exists and inspect outgoing TypeSafe payload via fetch mock
    const invRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `Decision Milk ${tag}`,
        category: "Dairy & Milk",
        quantity: 2,
        unit: "L",
        maximumStock: 20,
        purchasePrice: 200,
        packageQuantity: 1,
        contentsPerPackage: 2,
      },
    });
    assert.equal(invRes.status, 201);
    tracker.inventoryItemIds.add(Number(invRes.data.id));

    const prevKey = process.env.TYPESAFE_API_KEY;
    const origFetch = globalThis.fetch;
    let capturedAiBody = null;
    process.env.TYPESAFE_API_KEY = "test-typesafe-key";
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://api.typesafe.ai/")) {
        capturedAiBody = JSON.parse(String(init?.body || "{}"));
        return new Response(JSON.stringify({ model: "jev-latest", answers: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return origFetch(url, init);
    };

    try {
      const triageRes = await server.requestJson("/api/decisions/inventory-triage", {
        method: "POST",
        token: admin.token,
        body: {},
      });
      assert.equal(triageRes.status, 200, `Expected 200 on inventory-triage, got ${triageRes.text}`);
      assert.ok(capturedAiBody?.state?.inventory?.length > 0);
      for (const entry of capturedAiBody.state.inventory) {
        assert.equal(Object.hasOwn(entry, "unitCost"), false, "unitCost must be omitted from AI payload");
        assert.equal(Object.hasOwn(entry, "unit_cost"), false, "unit_cost must be omitted from AI payload");
      }
    } finally {
      globalThis.fetch = origFetch;
      if (prevKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = prevKey;
    }
  });

  it("scopes confirm-sales by orderIds & inspectedBefore and curbs staff notification broadcast scope", async () => {
    const tag = makeUniqueTag("ConfirmScope");
    const admin = await tracker.createUser({ role: "admin", password: `Adm_${tag}` });
    const staff1 = await tracker.createUser({
      role: "staff",
      username: "staff",
      displayName: `Scope Staff 1 ${tag}`,
      password: `Stf1_${tag}`,
    });
    const staff2 = await tracker.createUser({
      role: "staff",
      username: "staff",
      displayName: `Scope Staff 2 ${tag}`,
      password: `Stf2_${tag}`,
    });

    const invRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `Scope Cup ${tag}`,
        category: "Cups & Lids",
        quantity: 20,
        unit: "pcs",
        purchasePrice: 200,
        packageQuantity: 1,
        contentsPerPackage: 20,
      },
    });
    assert.equal(invRes.status, 201);
    const ingId = Number(invRes.data.id);
    tracker.inventoryItemIds.add(ingId);

    const [catRow] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'drink')",
      [`Scope_Cat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(catRow.insertId));

    const prodRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Scope Latte ${tag}`,
        category: `Scope_Cat_${tag}`,
        price: "80.00",
        stock: 0,
        sizes: [
          {
            label: "Regular",
            price: 80,
            ingredients: [{ inventoryItemId: ingId, name: `Scope Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
          },
        ],
        ingredients: [{ inventoryItemId: ingId, name: `Scope Cup ${tag}`, quantityUsed: 1, unit: "pcs", stockUnit: "pcs" }],
      },
    });
    assert.equal(prodRes.status, 201, `Menu create failed: ${prodRes.text}`);
    const productId = Number(prodRes.data.id);
    tracker.productIds.add(productId);

    const o1 = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff1.token,
      body: { type: "Counter", paymentMethod: "Cash", cashTendered: 80, items: [{ productId, quantity: 1 }] },
    });
    const o2 = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff1.token,
      body: { type: "Counter", paymentMethod: "Cash", cashTendered: 80, items: [{ productId, quantity: 1 }] },
    });
    assert.equal(o1.status, 201);
    assert.equal(o2.status, 201);

    const [[row1]] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [o1.data.id]);
    const [[row2]] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [o2.data.id]);

    // Backdate order 1 by 2 hours so inspectedBefore can cleanly bisect o1 and o2
    await pool.execute("UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE id = ?", [row1.id]);

    // Confirm strictly order 1 using orderIds + inspectedBefore
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const confirmRes = await server.requestJson(`/api/reports/staff/${staff1.id}/confirm-sales`, {
      method: "POST",
      token: admin.token,
      body: {
        orderIds: [Number(row1.id)],
        inspectedBefore: cutoff,
        note: `Scoped confirmation ${tag}`,
      },
    });
    assert.equal(confirmRes.status, 200, `confirm-sales failed: ${confirmRes.text}`);
    assert.equal(confirmRes.data.confirmedOrdersCount, 1);

    const [[after1]] = await pool.execute("SELECT owner_confirmed_at FROM orders WHERE id = ?", [row1.id]);
    const [[after2]] = await pool.execute("SELECT owner_confirmed_at FROM orders WHERE id = ?", [row2.id]);
    assert.ok(after1.owner_confirmed_at, "Order 1 must be confirmed");
    assert.equal(after2.owner_confirmed_at, null, "Order 2 must remain unconfirmed");

    // Staff notification broadcast scope: staff POST /api/notifications only lands in self inbox
    const evtKey = `staff-self-only-${tag}`;
    const notifPost = await server.requestJson("/api/notifications", {
      method: "POST",
      token: staff1.token,
      body: { type: "order_new", title: `Order Notice ${tag}`, message: "Self scoped", eventKey: evtKey },
    });
    assert.equal(notifPost.status, 201);

    const [notifRows] = await pool.execute("SELECT user_id FROM notifications WHERE event_key = ?", [evtKey]);
    assert.deepEqual(
      notifRows.map((r) => Number(r.user_id)),
      [staff1.id],
      "Staff POST /api/notifications must not broadcast to admin or other cashiers",
    );
    const staff2Notifs = await server.requestJson("/api/notifications", { token: staff2.token });
    assert.equal(staff2Notifs.data.some((n) => n.eventKey === evtKey), false);
  });

  it("clean-installs migrations 001..042 on an empty ephemeral DB and verifies schema + 040/041/042 constraints", async () => {
    const tempDbName = "amaya_clean_install_test";
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      timezone: "+08:00",
    });

    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${tempDbName}\``);
      await conn.query(`CREATE DATABASE \`${tempDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

      await execFileAsync(process.execPath, [path.resolve("api/src/migrate.js")], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DB_NAME: tempDbName,
          NODE_ENV: "test",
        },
        timeout: 60_000,
      });

      const [tables] = await conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ?",
        [tempDbName],
      );
      const tableSet = new Set(tables.map((t) => String(t.table_name || t.TABLE_NAME)));
      for (const expectedTable of [
        "users",
        "menu_categories",
        "menu_products",
        "inventory_items",
        "orders",
        "cashier_sessions",
        "journal_entries",
        "order_item_reversals",
        "business_settings",
        "schema_migrations",
      ]) {
        assert.ok(tableSet.has(expectedTable), `Clean install missing table: ${expectedTable}`);
      }

      const [indexes] = await conn.execute(
        `SELECT table_name, index_name
           FROM information_schema.statistics
          WHERE table_schema = ?`,
        [tempDbName],
      );
      const indexPairs = new Set(
        indexes.map((r) => `${r.table_name || r.TABLE_NAME}.${r.index_name || r.INDEX_NAME}`),
      );
      for (const expectedIdx of [
        "cashier_sessions.uq_cashier_sessions_open_user",
        "orders.uq_orders_client_request_id",
        "inventory_items.uq_inventory_items_client_request_id",
        "inventory_movements.uq_inventory_movements_user_client_request",
        "order_item_reversals.uq_order_item_reversals_user_client_request",
        "orders.idx_orders_paid_at",
        "inventory_movements.idx_inventory_movements_created_at",
        "notifications.idx_notifications_user_read",
        "journal_entry_lines.idx_jel_account_entry_amounts",
        "order_inventory_consumptions.idx_oic_rev_inv_order",
      ]) {
        assert.ok(indexPairs.has(expectedIdx), `Clean install missing 040/041/042 index: ${expectedIdx}`);
      }

      const [fks] = await conn.execute(
        `SELECT table_name, constraint_name
           FROM information_schema.table_constraints
          WHERE table_schema = ? AND constraint_type = 'FOREIGN KEY'`,
        [tempDbName],
      );
      const fkPairs = new Set(
        fks.map((r) => `${r.table_name || r.TABLE_NAME}.${r.constraint_name || r.CONSTRAINT_NAME}`),
      );
      for (const expectedFk of [
        "inventory_items.fk_inventory_items_category",
        "journal_entries.fk_je_inventory_movement",
        "inventory_movements.fk_inventory_movements_reversed_by",
        "financial_payables.fk_fp_expense_account",
        "financial_payables.fk_fp_liability_account",
      ]) {
        assert.ok(fkPairs.has(expectedFk), `Clean install missing 041 FK: ${expectedFk}`);
      }
    } finally {
      await conn.query(`DROP DATABASE IF EXISTS \`${tempDbName}\``).catch(() => {});
      await conn.end();
    }
  });

  it("verifies React/frontend helper exports and source invariants for logout, revert gating, and error preservation", async () => {
    const id1 = createClientRequestId("ord");
    const id2 = createClientRequestId("rev");
    assert.match(id1, CLIENT_REQUEST_ID_REGEX);
    assert.match(id2, CLIENT_REQUEST_ID_REGEX);
    assert.notEqual(id1, id2);

    const authCtxSource = await fs.readFile(path.resolve("src/context/AuthContext.jsx"), "utf8");
    assert.match(authCtxSource, /apiRequest\("\/auth\/logout",\s*\{\s*method:\s*"POST"\s*\}\)/);
    assert.match(authCtxSource, /setAuthToken\(null\)/);

    const modalSource = await fs.readFile(path.resolve("src/components/OrderDetailsModal.jsx"), "utf8");
    assert.match(modalSource, /needsAdminOnlyForRevert/);
    assert.match(modalSource, /needsPeerOrAdminForRevert/);
    assert.match(modalSource, /needsAuthorizationPasswordForRevert/);
    assert.match(modalSource, /createClientRequestId\("rev"\)/);

    const ordersCtxSource = await fs.readFile(path.resolve("src/context/OrdersContext.jsx"), "utf8");
    assert.match(ordersCtxSource, /setOrdersError\(error\?\.message \|\| "Could not load orders\."\)/);

    const mainSource = await fs.readFile(path.resolve("src/main.jsx"), "utf8");
    assert.match(mainSource, /isPortal \?/);
  });

  it("supports cacheable /api/media endpoints with ETag/304, ?media=url, active-queue orders, and /reports/hourly-sales", async () => {
    const tag = makeUniqueTag("Batch3B");
    const admin = await tracker.createUser({ role: "admin", password: `Adm_${tag}` });
    const staff = await tracker.createUser({
      role: "staff",
      username: "staff",
      displayName: `B3B Staff ${tag}`,
      password: `Stf_${tag}`,
    });

    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const invRes = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: {
        item: `Media Bean ${tag}`,
        category: "Coffee & Espresso",
        quantity: 20,
        unit: "g",
        image: tinyPng,
        purchasePrice: 100,
        packageQuantity: 1,
        contentsPerPackage: 20,
      },
    });
    assert.equal(invRes.status, 201);
    const invId = Number(invRes.data.id);
    tracker.inventoryItemIds.add(invId);

    const [catRow] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'food')",
      [`B3B_Cat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(catRow.insertId));

    const prodRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Media Toast ${tag}`,
        category: `B3B_Cat_${tag}`,
        price: "75.00",
        stock: 0,
        image: tinyPng,
        sizes: [{ label: "Regular", price: 75, ingredients: [{ inventoryItemId: invId, name: `Media Bean ${tag}`, quantityUsed: 5, unit: "g", stockUnit: "g" }] }],
        ingredients: [{ inventoryItemId: invId, name: `Media Bean ${tag}`, quantityUsed: 5, unit: "g", stockUnit: "g" }],
      },
    });
    assert.equal(prodRes.status, 201);
    const prodId = Number(prodRes.data.id);
    tracker.productIds.add(prodId);

    // ?media=url rewrites data URIs to /api/media/... URLs
    const menuUrlRes = await server.requestJson("/api/menu?all=true&media=url", { token: admin.token });
    assert.equal(menuUrlRes.status, 200);
    const matchedProd = menuUrlRes.data.find((p) => p.id === prodId);
    assert.ok(matchedProd?.image?.startsWith(`/api/media/menu/${prodId}`));

    const invUrlRes = await server.requestJson("/api/inventory?media=url", { token: admin.token });
    assert.equal(invUrlRes.status, 200);
    const matchedInv = invUrlRes.data.find((i) => i.id === invId);
    assert.ok(matchedInv?.image?.startsWith(`/api/media/inventory/${invId}`));

    // Fetch binary image + verify Cache-Control + ETag 304
    const mediaFetch = await fetch(`${server.baseUrl}${matchedProd.image}`);
    assert.equal(mediaFetch.status, 200);
    assert.equal(mediaFetch.headers.get("content-type"), "image/png");
    assert.match(mediaFetch.headers.get("cache-control") || "", /max-age=86400/);
    const etag = mediaFetch.headers.get("etag");
    assert.ok(etag);

    const media304 = await fetch(`${server.baseUrl}${matchedProd.image}`, {
      headers: { "If-None-Match": etag },
    });
    assert.equal(media304.status, 304);

    // Active-queue & status filter on /api/orders + /api/reports/hourly-sales
    const orderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staff.token,
      body: { type: "Counter", paymentMethod: "Cash", cashTendered: 75, items: [{ productId: prodId, quantity: 1 }] },
    });
    assert.equal(orderRes.status, 201);

    const queueRes = await server.requestJson("/api/orders/active-queue", { token: staff.token });
    assert.equal(queueRes.status, 200);
    assert.ok(queueRes.data.some((o) => o.id === orderRes.data.id));

    const filteredRes = await server.requestJson("/api/orders?status=Pending,Preparing", { token: staff.token });
    assert.equal(filteredRes.status, 200);
    assert.ok(filteredRes.data.some((o) => o.id === orderRes.data.id));

    const badStatusRes = await server.requestJson("/api/orders?status=InvalidStatus", { token: staff.token });
    assert.equal(badStatusRes.status, 400);

    const hourlyRes = await server.requestJson("/api/reports/hourly-sales?rangeKey=today", { token: admin.token });
    assert.equal(hourlyRes.status, 200);
    assert.ok(Array.isArray(hourlyRes.data.hours));
    assert.ok(hourlyRes.data.totalOrders >= 1);
  });
});
