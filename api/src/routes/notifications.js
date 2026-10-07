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

router.post("/", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const type = String(request.body?.type || "info").trim().slice(0, 40);
  const title = String(request.body?.title || "Notice").trim().slice(0, 180);
  const message = String(request.body?.message || "").trim().slice(0, 1000);
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

router.post("/inventory-alerts/check", requireAuth, requireRole("admin", "staff"), async (_request, response) => {
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('amaya_inventory_alert_check', 5) AS acquired");
    if (Number(lock.acquired) !== 1) throw httpError(503, "Inventory alerts are busy. They will retry shortly.");
    lockAcquired = true;
    await connection.beginTransaction();
    const [items] = await connection.execute(
      `SELECT i.id, i.name, i.quantity, i.unit, i.minimum_stock, s.status AS previous_status
         FROM inventory_items i
         LEFT JOIN inventory_alert_states s ON s.inventory_item_id = i.id
        ORDER BY i.id FOR UPDATE`,
    );
    const alerts = [];
    for (const item of items) {
      const quantity = Number(item.quantity);
      const minimumStock = Number(item.minimum_stock);
      const status = quantity <= 0 ? "out" : minimumStock > 0 && quantity <= minimumStock ? "low" : "healthy";
      const previous = item.previous_status;
      await connection.execute(
        `INSERT INTO inventory_alert_states (inventory_item_id, status) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`, [item.id, status],
      );
      const enteredLow = status === "low" && previous !== "low" && previous !== "out";
      const enteredOut = status === "out" && previous !== "out";
      if (enteredLow || enteredOut) {
        const title = enteredOut ? `${item.name} is out of stock` : `${item.name} is low`;
        const message = `${quantity} ${item.unit} remaining${status === "low" ? ` · minimum ${minimumStock} ${item.unit}` : ""}`;
        alerts.push({ itemId: Number(item.id), type: status, title, message });
      }
    }
    if (alerts.length) {
      const title = alerts.length === 1 ? alerts[0].title : `Inventory needs attention · ${alerts.length} items`;
      const details = alerts.slice(0, 4).map((alert) => `${alert.title}: ${alert.message}`);
      if (alerts.length > details.length) details.push(`and ${alerts.length - details.length} more`);
      await connection.execute(
        `INSERT INTO notifications (user_id, event_key, type, title, message)
         SELECT id, ?, 'inventory_low', ?, ? FROM users WHERE is_active = TRUE`,
        [`inventory-alert-${randomUUID()}`, title, details.join(" · ")],
      );
    }
    await connection.commit();
    response.json({ checked: items.length, alerts: alerts.length });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    if (lockAcquired) await connection.execute("SELECT RELEASE_LOCK('amaya_inventory_alert_check')");
    connection.release();
  }
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
