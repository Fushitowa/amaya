import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";
import { loadBusinessSettings } from "./settings.js";

const router = Router();
export const ARCHIVE_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function computeRetention(archivedAtValue, retentionDays = ARCHIVE_RETENTION_DAYS) {
  const archivedAt = archivedAtValue ? new Date(archivedAtValue) : new Date();
  const expiresAt = new Date(archivedAt.getTime() + retentionDays * DAY_MS);
  const diffMs = expiresAt.getTime() - Date.now();
  const daysRemaining = Math.max(0, Math.ceil(diffMs / DAY_MS));
  return {
    archivedAt: archivedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    daysRemaining,
  };
}

export async function recordArchiveAudit(connectionOrPool, {
  entityType,
  entityId,
  entityName,
  action,
  actorId = null,
  actorName = "System",
  note = null,
}) {
  await connectionOrPool.execute(
    `INSERT INTO archive_audit_logs (entity_type, entity_id, entity_name, action, actor_id, actor_name, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entityType, Number(entityId), String(entityName || "Unknown").slice(0, 160), action, actorId, String(actorName || "System").slice(0, 80), note],
  );
}

/**
 * Permanently deletes an inventory item and cleans up its non-order child references.
 * Throws 409 if the item is still linked to any active/archived menu product or customer order consumption.
 */
export async function permanentlyDeleteInventoryItem(id, { actorId = null, actorName = "System", action = "manual_deleted", note = null } = {}) {
  const [linkedRows] = await pool.execute(
    `SELECT DISTINCT mp.name, mp.is_archived FROM menu_products mp
       JOIN product_ingredients pi ON pi.product_id = mp.id WHERE pi.inventory_item_id = ?
     UNION
     SELECT DISTINCT mp.name, mp.is_archived FROM menu_products mp
       JOIN product_sizes ps ON ps.product_id = mp.id
       JOIN product_size_ingredients psi ON psi.product_size_id = ps.id WHERE psi.inventory_item_id = ?
     UNION
     SELECT DISTINCT mp.name, mp.is_archived FROM menu_products mp
       JOIN product_addons pa ON pa.product_id = mp.id WHERE pa.inventory_item_id = ?`,
    [id, id, id],
  );
  if (linkedRows.length > 0) {
    const productNames = linkedRows.map((row) => `${row.name}${row.is_archived ? " (in Archive)" : ""}`).join(", ");
    throw httpError(409, `This inventory item is used in recipes/add-ons for: ${productNames}. Remove or permanently delete those menu items first.`);
  }
  const [[orderUsage]] = await pool.execute(
    "SELECT COUNT(*) AS consumptions FROM order_inventory_consumptions WHERE inventory_item_id = ?",
    [id],
  );
  if (Number(orderUsage.consumptions) > 0) {
    throw httpError(409, "This item was consumed in recorded customer orders and cannot be permanently deleted.");
  }
  const [[movementHistory]] = await pool.execute(
    "SELECT COUNT(*) AS movements FROM inventory_movements WHERE inventory_item_id = ?",
    [id],
  );
  if (Number(movementHistory.movements) > 0) {
    throw httpError(409, "This item has recorded inventory movement history and cannot be permanently deleted.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.execute("SELECT id, name, is_archived FROM inventory_items WHERE id = ? FOR UPDATE", [id]);
    if (!existing) throw httpError(404, "Inventory item not found.");
    if (!existing.is_archived) {
      throw httpError(409, "Only archived inventory items can be permanently deleted.");
    }
    const [[txMovements]] = await connection.execute(
      "SELECT COUNT(*) AS movements FROM inventory_movements WHERE inventory_item_id = ?",
      [id],
    );
    if (Number(txMovements.movements) > 0) {
      throw httpError(409, "This item has recorded inventory movement history and cannot be permanently deleted.");
    }
    await connection.execute("DELETE FROM product_ingredients WHERE inventory_item_id = ?", [id]);
    await connection.execute("DELETE FROM product_size_ingredients WHERE inventory_item_id = ?", [id]);
    await connection.execute("UPDATE product_addons SET inventory_item_id = NULL WHERE inventory_item_id = ?", [id]);
    await connection.execute("DELETE FROM inventory_items WHERE id = ?", [id]);
    await recordArchiveAudit(connection, {
      entityType: "inventory_item",
      entityId: existing.id,
      entityName: existing.name,
      action,
      actorId,
      actorName,
      note,
    });
    await connection.commit();
    return existing;
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_ROW_IS_REFERENCED_2") throw httpError(409, "This item has related order or movement history and cannot be permanently deleted.");
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Permanently deletes a menu product (cascades sizes, recipes, and add-ons; preserves order_items snapshots).
 */
export async function permanentlyDeleteMenuProduct(id, { actorId = null, actorName = "System", action = "manual_deleted", note = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.execute("SELECT id, name, is_archived FROM menu_products WHERE id = ? FOR UPDATE", [id]);
    if (!existing) throw httpError(404, "Menu item not found.");
    if (!existing.is_archived) {
      throw httpError(409, "Only archived menu products can be permanently deleted.");
    }
    await connection.execute("DELETE FROM menu_products WHERE id = ?", [id]);
    await recordArchiveAudit(connection, {
      entityType: "menu_product",
      entityId: existing.id,
      entityName: existing.name,
      action,
      actorId,
      actorName,
      note,
    });
    await connection.commit();
    return existing;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Background task: purges archived menu products and inventory items whose archived_at is >= 30 days ago.
 */
export async function runArchivePurgeCheck() {
  const bizSettings = await loadBusinessSettings().catch(() => ({ archiveRetentionDays: ARCHIVE_RETENTION_DAYS }));
  const retentionDays = Math.max(1, Number(bizSettings?.archiveRetentionDays) || ARCHIVE_RETENTION_DAYS);
  let purgedMenuCount = 0;
  let purgedInventoryCount = 0;
  const lockConn = await pool.getConnection();
  let acquiredLock = false;
  try {
    const [[lockRow]] = await lockConn.query("SELECT GET_LOCK('amaya_archive_purge', 0) AS locked");
    if (!Number(lockRow?.locked)) {
      return { purgedMenuCount: 0, purgedInventoryCount: 0, skippedLock: true };
    }
    acquiredLock = true;

    // 1. Purge expired menu products first (which also frees up any recipe links to archived inventory items)
    const [expiredProducts] = await lockConn.execute(
      `SELECT id, name FROM menu_products
        WHERE is_archived = TRUE
          AND archived_at IS NOT NULL
          AND archived_at <= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [retentionDays],
    );
    for (const product of expiredProducts) {
      try {
        await permanentlyDeleteMenuProduct(Number(product.id), {
          actorId: null,
          actorName: "System Auto-Purge",
          action: "purged",
          note: `Automatically purged after ${retentionDays} days in Archive`,
        });
        purgedMenuCount += 1;
      } catch (error) {
        console.warn(`Could not auto-purge menu product #${product.id} (${product.name}):`, error.message);
      }
    }

    // 2. Purge expired inventory items (if not consumed in customer orders or linked to remaining products)
    const [expiredInventory] = await lockConn.execute(
      `SELECT id, name FROM inventory_items
        WHERE is_archived = TRUE
          AND archived_at IS NOT NULL
          AND archived_at <= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [retentionDays],
    );
    for (const item of expiredInventory) {
      try {
        await permanentlyDeleteInventoryItem(Number(item.id), {
          actorId: null,
          actorName: "System Auto-Purge",
          action: "purged",
          note: `Automatically purged after ${retentionDays} days in Archive`,
        });
        purgedInventoryCount += 1;
      } catch (error) {
        console.warn(`Could not auto-purge inventory item #${item.id} (${item.name}):`, error.message);
      }
    }

    return { purgedMenuCount, purgedInventoryCount };
  } finally {
    if (acquiredLock) {
      await lockConn.query("SELECT RELEASE_LOCK('amaya_archive_purge')").catch(() => {});
    }
    lockConn.release();
  }
}

// GET /api/archive -> returns archived menu items, archived inventory items, and recent audit logs
router.get("/", requireAuth, requireRole("admin"), async (_request, response) => {
  await runArchivePurgeCheck().catch(() => null);
  const bizSettings = await loadBusinessSettings().catch(() => ({ archiveRetentionDays: ARCHIVE_RETENTION_DAYS }));
  const retentionDays = Math.max(1, Number(bizSettings?.archiveRetentionDays) || ARCHIVE_RETENTION_DAYS);

  const [menuRows, inventoryRows, auditRows] = await Promise.all([
    pool.execute(
      `SELECT p.id, p.name, p.description, p.image_url, p.base_price, p.stock_quantity,
              p.archived_at, c.name AS category, COALESCE(NULLIF(u.display_name, ''), u.username) AS archived_by_name
         FROM menu_products p
         LEFT JOIN menu_categories c ON c.id = p.category_id
         LEFT JOIN users u ON u.id = p.archived_by
        WHERE p.is_archived = TRUE
        ORDER BY p.archived_at DESC, p.id DESC`,
    ),
    pool.execute(
      `SELECT i.id, i.name, i.category, i.quantity, i.unit, i.maximum_stock,
              i.archived_at, COALESCE(NULLIF(u.display_name, ''), u.username) AS archived_by_name,
              (SELECT COUNT(*) FROM order_inventory_consumptions oic WHERE oic.inventory_item_id = i.id) AS order_consumptions
         FROM inventory_items i
         LEFT JOIN users u ON u.id = i.archived_by
        WHERE i.is_archived = TRUE
        ORDER BY i.archived_at DESC, i.id DESC`,
    ),
    pool.execute(
      `SELECT id, entity_type, entity_id, entity_name, action, actor_name, note, created_at
         FROM archive_audit_logs
        ORDER BY created_at DESC, id DESC
        LIMIT 100`,
    ),
  ]);

  const menuProducts = menuRows[0].map((row) => ({
    id: Number(row.id),
    name: row.name,
    category: row.category || "Uncategorized",
    description: row.description || "",
    image: row.image_url || "",
    image_url: row.image_url || "",
    price: `₱${Number(row.base_price).toFixed(2)}`,
    base_price: Number(row.base_price),
    stock: Number(row.stock_quantity || 0),
    archivedBy: row.archived_by_name || "Admin",
    archived_by_username: row.archived_by_name || "Admin",
    ...computeRetention(row.archived_at, retentionDays),
  }));

  const inventoryItems = inventoryRows[0].map((row) => ({
    id: Number(row.id),
    name: row.name,
    item: row.name,
    category: row.category || "Supplies",
    quantity: Number(row.quantity || 0),
    unit: row.unit || "pcs",
    maximumStock: row.maximum_stock == null ? null : Number(row.maximum_stock),
    orderConsumptions: Number(row.order_consumptions || 0),
    archivedBy: row.archived_by_name || "Admin",
    archived_by_username: row.archived_by_name || "Admin",
    ...computeRetention(row.archived_at, retentionDays),
  }));

  const auditLogs = auditRows[0].map((row) => ({
    id: Number(row.id),
    entityType: row.entity_type,
    entity_type: row.entity_type,
    entityId: Number(row.entity_id),
    entity_id: Number(row.entity_id),
    entityName: row.entity_name,
    entity_name: row.entity_name,
    action: row.action,
    actor: row.actor_name || "System",
    actorName: row.actor_name || "System",
    actor_name: row.actor_name || "System",
    note: row.note || "",
    timestamp: new Date(row.created_at).toISOString(),
    created_at: new Date(row.created_at).toISOString(),
  }));

  response.json({
    retentionDays,
    counts: {
      menu: menuProducts.length,
      inventory: inventoryItems.length,
      audit: auditLogs.length,
      total: menuProducts.length + inventoryItems.length,
      totalArchived: menuProducts.length + inventoryItems.length,
    },
    menuProducts,
    inventoryItems,
    auditLogs,
  });
});

// POST /api/archive/restore/:type/:id -> restores an archived menu product or inventory item
router.post("/restore/:type/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const type = String(request.params.type || "").toLowerCase();
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid item ID.");
  const actorId = Number(request.authUser?.sub) || null;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";

  if (type === "menu") {
    const [[existing]] = await pool.execute("SELECT id, name, is_archived FROM menu_products WHERE id = ?", [id]);
    if (!existing) throw httpError(404, "Archived menu item not found.");
    if (!existing.is_archived) throw httpError(409, "This menu item is already active.");
    const [archivedIngRows] = await pool.execute(
      `SELECT DISTINCT ii.name FROM inventory_items ii
         JOIN product_ingredients pi ON pi.inventory_item_id = ii.id WHERE pi.product_id = ? AND ii.is_archived = TRUE
       UNION
       SELECT DISTINCT ii.name FROM inventory_items ii
         JOIN product_size_ingredients psi ON psi.inventory_item_id = ii.id
         JOIN product_sizes ps ON ps.id = psi.product_size_id WHERE ps.product_id = ? AND ii.is_archived = TRUE
       UNION
       SELECT DISTINCT ii.name FROM inventory_items ii
         JOIN product_addons pa ON pa.inventory_item_id = ii.id WHERE pa.product_id = ? AND ii.is_archived = TRUE`,
      [id, id, id],
    );
    if (archivedIngRows.length > 0) {
      const names = archivedIngRows.map((r) => r.name).join(", ");
      throw httpError(409, `Cannot restore “${existing.name}” until its archived ingredient(s) are restored first: ${names}.`);
    }
    await pool.execute(
      "UPDATE menu_products SET is_archived = FALSE, archived_at = NULL, archived_by = NULL WHERE id = ?",
      [id],
    );
    await recordArchiveAudit(pool, {
      entityType: "menu_product",
      entityId: existing.id,
      entityName: existing.name,
      action: "restored",
      actorId,
      actorName,
      note: "Restored to active menu catalog",
    });
    return response.json({ message: `${existing.name} was restored to Menu Management.` });
  }

  if (type === "inventory") {
    const [[existing]] = await pool.execute("SELECT id, name, is_archived FROM inventory_items WHERE id = ?", [id]);
    if (!existing) throw httpError(404, "Archived inventory item not found.");
    if (!existing.is_archived) throw httpError(409, "This inventory item is already active.");
    const [[collision]] = await pool.execute(
      "SELECT id FROM inventory_items WHERE LOWER(name) = LOWER(?) AND is_archived = FALSE AND id <> ? LIMIT 1",
      [existing.name, id],
    );
    if (collision) {
      throw httpError(409, `Cannot restore “${existing.name}”: an active inventory item with that name already exists.`);
    }
    await pool.execute(
      "UPDATE inventory_items SET is_archived = FALSE, archived_at = NULL, archived_by = NULL WHERE id = ?",
      [id],
    );
    await recordArchiveAudit(pool, {
      entityType: "inventory_item",
      entityId: existing.id,
      entityName: existing.name,
      action: "restored",
      actorId,
      actorName,
      note: "Restored to active inventory",
    });
    return response.json({ message: `${existing.name} was restored to Inventory.` });
  }

  throw httpError(400, "Invalid archive entity type. Expected 'menu' or 'inventory'.");
});

// DELETE /api/archive/empty -> permanently deletes all archived items that can be purged
router.delete("/empty", requireAuth, requireRole("admin"), async (request, response) => {
  const actorId = Number(request.authUser?.sub) || null;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";

  const [archivedMenu] = await pool.execute("SELECT id, name FROM menu_products WHERE is_archived = TRUE");
  let deletedMenu = 0;
  const skippedMenu = [];
  for (const product of archivedMenu) {
    try {
      await permanentlyDeleteMenuProduct(Number(product.id), {
        actorId,
        actorName,
        action: "manual_deleted",
        note: "Permanently deleted via Empty Archive",
      });
      deletedMenu += 1;
    } catch (error) {
      skippedMenu.push(`${product.name} (${error.message})`);
    }
  }

  const [archivedInventory] = await pool.execute("SELECT id, name FROM inventory_items WHERE is_archived = TRUE");
  let deletedInventory = 0;
  const skippedInventory = [];
  for (const item of archivedInventory) {
    try {
      await permanentlyDeleteInventoryItem(Number(item.id), {
        actorId,
        actorName,
        action: "manual_deleted",
        note: "Permanently deleted via Empty Archive",
      });
      deletedInventory += 1;
    } catch (error) {
      skippedInventory.push(`${item.name} (${error.message})`);
    }
  }

  const skippedCount = skippedMenu.length + skippedInventory.length;
  response.json({
    deletedMenu,
    deletedInventory,
    skippedMenu,
    skippedInventory,
    message: skippedCount > 0
      ? `Deleted ${deletedMenu} menu and ${deletedInventory} inventory item(s); skipped ${skippedCount} item(s) still linked to active recipes or order history.`
      : `Permanently deleted ${deletedMenu} menu item(s) and ${deletedInventory} inventory item(s).`,
  });
});

// DELETE /api/archive/:type/:id -> permanently deletes a single archived item immediately
router.delete("/:type/:id", requireAuth, requireRole("admin"), async (request, response) => {
  const type = String(request.params.type || "").toLowerCase();
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid item ID.");
  const actorId = Number(request.authUser?.sub) || null;
  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";

  if (type === "menu") {
    const deleted = await permanentlyDeleteMenuProduct(id, {
      actorId,
      actorName,
      action: "manual_deleted",
      note: "Permanently deleted from Archive before 30-day expiry",
    });
    return response.json({ message: `${deleted.name} was permanently deleted.` });
  }

  if (type === "inventory") {
    const deleted = await permanentlyDeleteInventoryItem(id, {
      actorId,
      actorName,
      action: "manual_deleted",
      note: "Permanently deleted from Archive before 30-day expiry",
    });
    return response.json({ message: `${deleted.name} was permanently deleted.` });
  }

  throw httpError(400, "Invalid archive entity type. Expected 'menu' or 'inventory'.");
});

export default router;
