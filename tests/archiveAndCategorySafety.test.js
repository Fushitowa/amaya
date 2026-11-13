import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

describe("Archive Lifecycle, Safety Guards & Category Reassign-and-Delete", () => {
  let server;
  let adminUser;
  const tracker = createCleanupTracker();
  const auditActors = new Set();

  before(async () => {
    server = await startTestServer();
    adminUser = await tracker.createUser({
      role: "admin",
      displayName: "Archive QA Admin",
      username: makeUniqueTag("arch_admin").toLowerCase(),
    });
    auditActors.add(adminUser.id);
  });

  after(async () => {
    try {
      if (auditActors.size > 0) {
        const ids = [...auditActors];
        await pool.execute(
          `DELETE FROM archive_audit_logs WHERE actor_id IN (${ids.map(() => "?").join(",")})`,
          ids,
        );
      }
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
    }
  });

  it("archives, exposes dynamic retentionDays, blocks deleting order-linked products, restores, and permanently deletes unlinked items", async () => {
    await tracker.trackBusinessSettings();
    const tag = makeUniqueTag("ArchSafety");
    let orderId = null;

    try {
      const setRes = await server.requestJson("/api/settings", {
        method: "PUT",
        token: adminUser.token,
        body: {
          businessName: "Amaya's Drinks and Bites",
          email: "amayadrinksandbites@gmail.com",
          archiveRetentionDays: 60,
        },
      });
      assert.equal(setRes.status, 200);

      const [catRes] = await pool.execute(
        "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
        [`Cat_${tag}`],
      );
      tracker.menuCategoryIds.add(Number(catRes.insertId));

      const linkedProdRes = await server.requestJson("/api/menu", {
        method: "POST",
        token: adminUser.token,
        body: {
          name: `Linked_${tag}`,
          category: `Cat_${tag}`,
          basePrice: 75,
          costPrice: 25,
          stock: 10,
          available: true,
          ingredients: [],
        },
      });
      assert.equal(linkedProdRes.status, 201);
      const linkedProdId = Number(linkedProdRes.data.id);
      tracker.productIds.add(linkedProdId);

      const cleanProdRes = await server.requestJson("/api/menu", {
        method: "POST",
        token: adminUser.token,
        body: {
          name: `Clean_${tag}`,
          category: `Cat_${tag}`,
          basePrice: 55,
          costPrice: 15,
          stock: 5,
          available: true,
          ingredients: [],
        },
      });
      assert.equal(cleanProdRes.status, 201);
      const cleanProdId = Number(cleanProdRes.data.id);
      tracker.productIds.add(cleanProdId);

      // Link first product to an order
      const ordRes = await server.requestJson("/api/orders", {
        method: "POST",
        token: adminUser.token,
        body: {
          items: [{ productId: linkedProdId, quantity: 1 }],
          paymentMethod: "Cash",
          cashTendered: 100,
        },
      });
      assert.equal(ordRes.status, 201);
      const [[dbOrd]] = await pool.execute("SELECT id FROM orders WHERE order_number = ?", [ordRes.data.id]);
      orderId = Number(dbOrd.id);
      tracker.orderIds.add(orderId);

      // Soft-delete both
      assert.equal((await server.requestJson(`/api/menu/${linkedProdId}`, { method: "DELETE", token: adminUser.token })).status, 204);
      assert.equal((await server.requestJson(`/api/menu/${cleanProdId}`, { method: "DELETE", token: adminUser.token })).status, 204);

      // GET /api/archive must report configured retentionDays = 60 and list both
      const archiveList = await server.requestJson("/api/archive", { token: adminUser.token });
      assert.equal(archiveList.status, 200);
      assert.equal(archiveList.data.retentionDays, 60);
      assert.ok(archiveList.data.menuProducts.some((p) => p.id === linkedProdId));
      assert.ok(archiveList.data.menuProducts.some((p) => p.id === cleanProdId));

      // Restore linked product cleanly
      const restoreRes = await server.requestJson(`/api/archive/restore/menu/${linkedProdId}`, {
        method: "POST",
        token: adminUser.token,
      });
      assert.equal(restoreRes.status, 200);
      const [[restoredRow]] = await pool.execute("SELECT is_archived FROM menu_products WHERE id = ?", [linkedProdId]);
      assert.equal(Number(restoredRow.is_archived), 0);

      // Permanent delete of unlinked product must succeed
      const permClean = await server.requestJson(`/api/archive/menu/${cleanProdId}`, {
        method: "DELETE",
        token: adminUser.token,
      });
      assert.equal(permClean.status, 200);
      tracker.productIds.delete(cleanProdId);
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

  it("blocks direct deletion of populated categories and reassigns items atomically on reassign-and-delete (menu & inventory)", async () => {
    const tag = makeUniqueTag("CatReassign");

    // 1. Menu categories
    const mSrc = await server.requestJson("/api/menu/categories", {
      method: "POST",
      token: adminUser.token,
      body: { name: `SrcMenu_${tag}`, operationalFamily: "single_fixed" },
    });
    assert.equal(mSrc.status, 201);
    const mSrcId = Number(mSrc.data.id);
    tracker.menuCategoryIds.add(mSrcId);

    const mDst = await server.requestJson("/api/menu/categories", {
      method: "POST",
      token: adminUser.token,
      body: { name: `DstMenu_${tag}`, operationalFamily: "single_fixed" },
    });
    assert.equal(mDst.status, 201);
    const mDstId = Number(mDst.data.id);
    tracker.menuCategoryIds.add(mDstId);

    const prod = await server.requestJson("/api/menu", {
      method: "POST",
      token: adminUser.token,
      body: {
        name: `ReassignDrink_${tag}`,
        category: `SrcMenu_${tag}`,
        basePrice: 80,
        costPrice: 20,
        stock: 5,
        available: true,
        ingredients: [],
      },
    });
    assert.equal(prod.status, 201);
    const prodId = Number(prod.data.id);
    tracker.productIds.add(prodId);

    const directDelMenu = await server.requestJson(`/api/menu/categories/${mSrcId}`, {
      method: "DELETE",
      token: adminUser.token,
    });
    assert.equal(directDelMenu.status, 409);

    const reassignMenu = await server.requestJson(`/api/menu/categories/${mSrcId}/reassign-and-delete`, {
      method: "PUT",
      token: adminUser.token,
      body: { targetCategoryId: mDstId },
    });
    assert.equal(reassignMenu.status, 200);
    tracker.menuCategoryIds.delete(mSrcId);

    const [[movedProd]] = await pool.execute("SELECT category_id FROM menu_products WHERE id = ?", [prodId]);
    assert.equal(Number(movedProd.category_id), mDstId);

    // 2. Inventory categories
    const iSrc = await server.requestJson("/api/inventory/categories", {
      method: "POST",
      token: adminUser.token,
      body: { name: `SrcInv_${tag}` },
    });
    assert.equal(iSrc.status, 201);
    const iSrcId = Number(iSrc.data.id);
    tracker.inventoryCategoryIds.add(iSrcId);

    const iDst = await server.requestJson("/api/inventory/categories", {
      method: "POST",
      token: adminUser.token,
      body: { name: `DstInv_${tag}` },
    });
    assert.equal(iDst.status, 201);
    const iDstId = Number(iDst.data.id);
    tracker.inventoryCategoryIds.add(iDstId);

    const inv = await server.requestJson("/api/inventory", {
      method: "POST",
      token: adminUser.token,
      body: {
        item: `ReassignBean_${tag}`,
        category: `SrcInv_${tag}`,
        quantity: 100,
        unit: "g",
        packageQuantity: 1,
        packageUnit: "pack",
        contentsPerPackage: 100,
        purchasePrice: 250,
      },
    });
    assert.equal(inv.status, 201);
    const invId = Number(inv.data.id);
    tracker.inventoryItemIds.add(invId);

    const directDelInv = await server.requestJson(`/api/inventory/categories/${iSrcId}`, {
      method: "DELETE",
      token: adminUser.token,
    });
    assert.equal(directDelInv.status, 409);

    const reassignInv = await server.requestJson(`/api/inventory/categories/${iSrcId}/reassign-and-delete`, {
      method: "PUT",
      token: adminUser.token,
      body: { targetCategoryId: iDstId },
    });
    assert.equal(reassignInv.status, 200);
    tracker.inventoryCategoryIds.delete(iSrcId);

    const [[movedInv]] = await pool.execute("SELECT category FROM inventory_items WHERE id = ?", [invId]);
    assert.equal(movedInv.category, `DstInv_${tag}`);
  });
});
