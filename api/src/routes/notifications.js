import { randomUUID } from "node:crypto";
import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

function mapNotification(row) {
  return {
    id: Number(row.id),
    eventKey: row.event_key,
    type: row.type,
    title: row.title,
    message: row.message,
    timestamp: new Date(row.created_at).toISOString(),
    read: Boolean(row.read_at),
    source: "server",
  };
}

router.get("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const [rows] = await pool.execute(
    "SELECT id, event_key, type, title, message, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
    [request.authUser.sub],
  );
  response.json(rows.map(mapNotification));
});

const STAFF_PERMITTED_EVENTS = new Set(["order_new", "order_completed", "receipt_printed"]);

router.post("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const type = String(request.body?.type || "info").trim().slice(0, 40);
  if (request.authUser.role === "staff" && !STAFF_PERMITTED_EVENTS.has(type)) {
    throw httpError(403, "Staff members are restricted to transaction event notifications.");
  }
  const title = String(request.body?.title || "Notice").trim().slice(0, 80);
  const message = String(request.body?.message || "").trim().slice(0, 200);
  const eventKey = String(request.body?.eventKey || randomUUID()).trim().slice(0, 120);
  if (!type || !title || !eventKey) throw httpError(400, "Notification type, title, and event key are required.");
  await pool.execute(
    `INSERT INTO notifications (user_id, event_key, type, title, message)
     SELECT id, ?, ?, ?, ? FROM users WHERE is_active = TRUE
     ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)`,
    [eventKey, type, title, message],
  );
  response.status(201).json({ saved: true, eventKey });
});

export async function runInventoryAlertCheck() {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  let transactionStarted = false;
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('amaya_inventory_alert_check', 5) AS acquired");
    if (Number(lock.acquired) !== 1) throw httpError(503, "Inventory alerts are busy. They will retry shortly.");
    lockAcquired = true;
    await connection.beginTransaction();
    transactionStarted = true;
    const [items] = await connection.execute(
      `SELECT i.id, i.name, i.quantity, i.unit, i.maximum_stock,
              s.status AS previous_status,
              COALESCE((SELECT MAX(m.created_at) FROM inventory_movements m WHERE m.inventory_item_id = i.id), i.created_at) AS last_activity_at,
              ia.last_activity_at AS previous_activity_at,
              ia.is_inactive AS was_inactive,
              (COALESCE((SELECT MAX(m.created_at) FROM inventory_movements m WHERE m.inventory_item_id = i.id), i.created_at) <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)) AS inactive_now
         FROM inventory_items i
         LEFT JOIN inventory_alert_states s ON s.inventory_item_id = i.id
         LEFT JOIN inventory_inactivity_states ia ON ia.inventory_item_id = i.id
        WHERE i.archived_at IS NULL
        ORDER BY i.id FOR UPDATE`,
    );
    const alerts = [];
    const inactiveAlerts = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      const maximumStock = item.maximum_stock == null ? null : Number(item.maximum_stock);
      const status = quantity <= 0 ? "out" : maximumStock !== null && maximumStock > 0 && quantity > maximumStock ? "over" : "healthy";
      const previous = item.previous_status;
      await connection.execute(
        `INSERT INTO inventory_alert_states (inventory_item_id, status) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`, [item.id, status],
      );
      const enteredOver = status === "over" && previous !== "over";
      const enteredOut = status === "out" && previous !== "out";
      if (enteredOver || enteredOut) {
        const title = enteredOut ? `${item.name} is out of stock` : `${item.name} is above maximum stock`;
        const message = enteredOut
          ? `No stock remaining${maximumStock !== null ? ` · maximum ${maximumStock} ${item.unit}` : ""}`
          : `${quantity} ${item.unit} on hand · maximum ${maximumStock} ${item.unit}`;
        alerts.push({ itemId: Number(item.id), type: status, title, message });
      }

      const inactive = Boolean(item.inactive_now);
      const lastActivityAt = new Date(item.last_activity_at).getTime();
      const previousActivityAt = item.previous_activity_at ? new Date(item.previous_activity_at).getTime() : null;
      const alreadyAlertedForThisInactivePeriod = Boolean(item.was_inactive)
        && previousActivityAt === lastActivityAt;
      if (inactive && !alreadyAlertedForThisInactivePeriod) {
        const inactiveDays = Math.max(30, Math.floor((Date.now() - lastActivityAt) / 86_400_000));
        inactiveAlerts.push({
          itemId: Number(item.id),
          name: item.name,
          inactiveDays,
          lastActivityAt,
        });
      }
      await connection.execute(
        `INSERT INTO inventory_inactivity_states (inventory_item_id, last_activity_at, is_inactive)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_activity_at = VALUES(last_activity_at), is_inactive = VALUES(is_inactive)`,
        [item.id, item.last_activity_at, inactive ? 1 : 0],
      );
    }
    if (alerts.length) {
      const title = alerts.length === 1 ? alerts[0].title : `Inventory stock limits · ${alerts.length} items`;
      const details = alerts.slice(0, 4).map((alert) => `${alert.title}: ${alert.message}`);
      if (alerts.length > details.length) details.push(`and ${alerts.length - details.length} more`);
      await connection.execute(
        `INSERT INTO notifications (user_id, event_key, type, title, message)
         SELECT id, ?, 'inventory_stock', ?, ? FROM users WHERE is_active = TRUE`,
        [`inventory-alert-${randomUUID()}`, title, details.join(" · ")],
      );
    }
    if (inactiveAlerts.length) {
      const title = inactiveAlerts.length === 1
        ? `${inactiveAlerts[0].name} has been inactive for 30+ days`
        : `${inactiveAlerts.length} inventory items inactive for 30+ days`;
      const details = inactiveAlerts.slice(0, 7).map((item) => {
        const date = new Date(item.lastActivityAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        return `${item.name} · no stock movement since ${date} (${item.inactiveDays} days)`;
      });
      if (inactiveAlerts.length > details.length) details.push(`and ${inactiveAlerts.length - details.length} more item${inactiveAlerts.length - details.length === 1 ? "" : "s"}`);
      await connection.execute(
        `INSERT INTO notifications (user_id, event_key, type, title, message)
         SELECT id, ?, 'inventory_inactive', ?, ? FROM users WHERE is_active = TRUE`,
        [`inventory-inactive-${randomUUID()}`, title, details.join(" · ").slice(0, 1000)],
      );
    }
    await connection.commit();
    return { checked: items.length, alerts: alerts.length, inactiveAlerts: inactiveAlerts.length };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    if (lockAcquired) await connection.execute("SELECT RELEASE_LOCK('amaya_inventory_alert_check')");
    connection.release();
  }
}

router.post("/inventory-alerts/check", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  response.json(await runInventoryAlertCheck());
});

router.patch("/read-all", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const [result] = await pool.execute(
    "UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL", [request.authUser.sub],
  );
  response.json({ updated: result.affectedRows });
});

router.patch("/:id/read", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw httpError(400, "Invalid notification ID.");
  const [result] = await pool.execute(
    "UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?", [id, request.authUser.sub],
  );
  if (!result.affectedRows) throw httpError(404, "Notification not found.");
  response.json({ updated: true });
});

router.delete("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  await pool.execute("DELETE FROM notifications WHERE user_id = ?", [request.authUser.sub]);
  response.status(204).end();
});

export default router;
