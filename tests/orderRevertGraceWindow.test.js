import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

describe("Cashier self-revert: 5-minute grace window, then peer/owner approval", () => {
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

  it("lets a cashier fix their own order within 5 minutes, then requires a coworker's or owner's password", async () => {
    const tag = makeUniqueTag("Grace");
    const admin = await tracker.createUser({ role: "admin" });
    const staffA = await tracker.createUser({ role: "staff", displayName: `Grace A ${tag}`, password: `GraceA_${tag}` });
    const staffB = await tracker.createUser({ role: "staff", displayName: `Grace B ${tag}`, password: `GraceB_${tag}` });

    const [cat] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
      [`Grace_Cat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(cat.insertId));
    const productRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Grace_Snack_${tag}`,
        category: `Grace_Cat_${tag}`,
        price: "50.00",
        costPrice: "20.00",
        stock: 20,
        sizes: [{ label: "Regular", price: 50 }],
        ingredients: [],
      },
    });
    assert.equal(productRes.status, 201);
    tracker.productIds.add(Number(productRes.data.id));

    const orderRes = await server.requestJson("/api/orders", {
      method: "POST",
      token: staffA.token,
      body: { type: "Counter", paymentMethod: "Cash", cashTendered: 200, items: [{ productId: Number(productRes.data.id), size: "Regular", quantity: 3 }] },
    });
    assert.equal(orderRes.status, 201);
    const orderNo = orderRes.data.id;
    const itemId = Number(orderRes.data.items[0].id);
    const [[dbOrder]] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [orderNo]);
    tracker.orderIds.add(Number(dbOrder.id));

    const revert = (token, extra = {}) => server.requestJson(`/api/orders/${orderNo}/items/${itemId}/revert`, {
      method: "POST",
      token,
      body: { quantity: 1, reason: "Grace window check", restoreStock: true, ...extra },
    });

    const withinGrace = await revert(staffA.token);
    assert.equal(withinGrace.status, 200, `self-revert within 5 minutes must work, got ${withinGrace.status}: ${withinGrace.text}`);

    await pool.execute("UPDATE orders SET created_at = DATE_SUB(NOW(), INTERVAL 6 MINUTE) WHERE id = ?", [dbOrder.id]);

    const afterGrace = await revert(staffA.token);
    assert.equal(afterGrace.status, 403);
    assert.match(afterGrace.data.message, /5 minutes/);

    const selfApproved = await revert(staffA.token, { authorizationPassword: staffA.password });
    assert.equal(selfApproved.status, 403, "a cashier cannot approve their own late revert");

    const peerApproved = await revert(staffA.token, { authorizationPassword: staffB.password });
    assert.equal(peerApproved.status, 200, `a coworker's password must approve the late revert, got ${peerApproved.status}: ${peerApproved.text}`);
  });
});
